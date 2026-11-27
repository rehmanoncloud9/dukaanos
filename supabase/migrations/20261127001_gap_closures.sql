-- DukaanOS · 20261127001 · Gap Closures: Returns, Stock Adjustments, Bad-Debt Write-offs,
-- Product Creation RPC, Passport Revocation, and Daily/Weekly/Monthly P&L Insights.
-- All financial writes remain strictly hash-chained, idempotent, integer paisa, and SUM(ledger)=0.

-- ───────────────────────────────────────────── 1. Passport revocation nonce & transaction types
alter table public.shops add column if not exists passport_nonce int not null default 0;

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%type%'
      and pg_get_constraintdef(oid) like '%sale%'
  loop
    execute format('alter table public.transactions drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('sale', 'payment', 'purchase', 'reversal', 'return', 'adjustment', 'writeoff'));

create or replace function public.rotate_passport_tokens(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  perform private.assert_member(p_shop_id);
  update public.shops set passport_nonce = passport_nonce + 1
  where id = p_shop_id returning passport_nonce into v;
  if v is null then raise exception 'SHOP_NOT_FOUND'; end if;
  insert into public.audit_events (shop_id, actor_id, event, payload)
  values (p_shop_id, (select auth.uid()), 'rotate_passport_tokens', jsonb_build_object('passport_nonce', v));
  return jsonb_build_object('ok', true, 'passport_nonce', v);
end $$;

-- ───────────────────────────────────────────── 2. record_return (item-level customer return / exchange)
create or replace function private.record_return_core(p_shop_id uuid, p_payload jsonb, p_actor uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_key text := p_payload->>'idempotency_key';
  v_cached jsonb;
  v_customer uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_line jsonb; v_prod public.products%rowtype;
  v_qty bigint; v_lt bigint; v_cost bigint;
  v_total bigint := 0; v_cost_sum bigint := 0;
  v_cash bigint; v_credit bigint;
  v_lines jsonb := '[]'::jsonb; v_entries jsonb := '[]'::jsonb;
  v_tx jsonb; v_resp jsonb; v_l jsonb;
begin
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.lock_shop(p_shop_id);
  v_cached := private.idem_begin(p_shop_id, v_key, 'record_return');
  if v_cached is not null then return v_cached; end if;

  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'NO_ITEMS';
  end if;
  if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and shop_id = p_shop_id) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    select * into v_prod from public.products
    where id = nullif(v_line->>'product_id', '')::uuid and shop_id = p_shop_id for update;
    if not found then raise exception 'PRODUCT_NOT_FOUND: %', v_line->>'product_id'; end if;

    v_qty := nullif(v_line->>'qty_base_units', '')::bigint;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY: %', v_prod.name; end if;

    v_lt := coalesce(nullif(v_line->>'refund_paisa', '')::bigint,
                     round(v_qty::numeric * v_prod.unit_price_paisa / v_prod.pack_size_base_units));
    if v_lt <= 0 then raise exception 'INVALID_AMOUNT'; end if;
    v_cost := round(v_qty::numeric * v_prod.cost_price_paisa / v_prod.pack_size_base_units);

    v_total := v_total + v_lt;
    v_cost_sum := v_cost_sum + v_cost;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'base_unit', v_prod.base_unit,
      'qty_base_units', v_qty, 'unit_price_paisa', v_prod.unit_price_paisa,
      'pack_size_base_units', v_prod.pack_size_base_units, 'line_total_paisa', v_lt,
      'cost_total_paisa', v_cost, 'spoken', v_line->>'spoken'));
  end loop;

  v_cash := least(greatest(coalesce(nullif(p_payload->>'cash_refund_paisa', '')::bigint, case when v_customer is null then v_total else 0 end), 0), v_total);
  v_credit := v_total - v_cash;
  if v_credit > 0 and v_customer is null then
    raise exception 'UDHAAR_REQUIRES_CUSTOMER' using hint = 'Select a customer to credit their khata, or refund cash';
  end if;

  -- Balanced double-entry for return: DR Sales 4010, CR Cash 1010, CR A/R 1120, DR Inventory 1200, CR COGS 5010
  v_entries := private.je('4010', v_total)
            || private.je('1010', -v_cash)
            || private.je('1120', -v_credit, v_customer)
            || private.je('1200', v_cost_sum)
            || private.je('5010', -v_cost_sum);

  v_tx := private.insert_tx(p_shop_id, jsonb_build_object(
      'type', 'return', 'customer_id', v_customer,
      'subtotal_paisa', v_total, 'discount_paisa', 0, 'total_paisa', v_total,
      'cash_paid_paisa', v_cash, 'credit_paisa', v_credit),
    v_entries, v_key, coalesce(p_payload->'audit_meta', '{}'::jsonb) || jsonb_build_object('reason', coalesce(p_payload->>'reason', 'customer-return')),
    p_actor, p_at);

  for v_l in select value from jsonb_array_elements(v_lines) loop
    insert into public.transaction_lines (transaction_id, shop_id, product_id, name_snapshot, base_unit, qty_base_units,
      unit_price_paisa, pack_size_base_units, line_total_paisa, cost_total_paisa, value_first, spoken)
    values ((v_tx->>'id')::uuid, p_shop_id, (v_l->>'product_id')::uuid, v_l->>'name', v_l->>'base_unit',
      (v_l->>'qty_base_units')::bigint, (v_l->>'unit_price_paisa')::bigint, (v_l->>'pack_size_base_units')::bigint,
      (v_l->>'line_total_paisa')::bigint, (v_l->>'cost_total_paisa')::bigint, false, v_l->>'spoken');
    insert into public.inventory_movements (shop_id, product_id, transaction_id, delta_base_units, reason, created_at)
    values (p_shop_id, (v_l->>'product_id')::uuid, (v_tx->>'id')::uuid, (v_l->>'qty_base_units')::bigint, 'adjustment', p_at);
  end loop;

  v_resp := jsonb_build_object(
    'status', 'COMMITTED', 'http', 200, 'deduplicated', false, 'duplicate_rows', 0, 'rows_for_key', 1,
    'type', 'return', 'transaction_id', v_tx->'id', 'seq', v_tx->'seq',
    'prev_hash', v_tx->'prev_hash', 'entry_hash', v_tx->'entry_hash', 'created_at', p_at, 'rls_shop_id', p_shop_id,
    'totals', jsonb_build_object('total_paisa', v_total, 'cash_paid_paisa', v_cash, 'credit_paisa', v_credit),
    'lines', v_lines, 'journal', private.journal(v_entries), 'delta', 0, 'warnings', '[]'::jsonb,
    'customer', case when v_customer is not null then private.customer_brief(v_customer) end,
    'rpc_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
  perform private.idem_finish(p_shop_id, v_key, (v_tx->>'id')::uuid, v_resp);
  insert into public.audit_events (shop_id, actor_id, event, payload, created_at)
  values (p_shop_id, p_actor, 'record_return', jsonb_build_object('tx', v_tx->'id', 'total', v_total), p_at);
  return v_resp;
end $$;

create or replace function public.record_return(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return private.record_return_core(p_shop_id, p_payload, (select auth.uid()), now());
end $$;

-- ───────────────────────────────────────────── 3. adjust_stock (wastage / spoilage / personal use / count)
create or replace function public.adjust_stock(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_key text := p_payload->>'idempotency_key';
  v_cached jsonb; v_prod public.products%rowtype;
  v_delta bigint := nullif(p_payload->>'delta_base_units', '')::bigint;
  v_reason text := coalesce(nullif(trim(p_payload->>'reason'), ''), 'wastage');
  v_unit_cost bigint; v_cost bigint;
  v_entries jsonb; v_tx jsonb; v_resp jsonb;
  v_actor uuid := (select auth.uid()); v_at timestamptz := now();
begin
  perform private.assert_member(p_shop_id);
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.lock_shop(p_shop_id);
  v_cached := private.idem_begin(p_shop_id, v_key, 'adjust_stock');
  if v_cached is not null then return v_cached; end if;

  if v_delta is null or v_delta = 0 then raise exception 'INVALID_QTY'; end if;
  select * into v_prod from public.products
  where id = nullif(p_payload->>'product_id', '')::uuid and shop_id = p_shop_id for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;

  v_unit_cost := case
    when v_prod.cost_price_paisa > 0 then v_prod.cost_price_paisa
    when v_prod.unit_price_paisa > 0 then greatest(100, round(v_prod.unit_price_paisa::numeric * 0.7))
    else 100
  end;
  v_cost := greatest(100, round(abs(v_delta)::numeric * v_unit_cost / v_prod.pack_size_base_units));

  if v_delta < 0 then
    v_entries := private.je('5010', v_cost) || private.je('1200', -v_cost);
  else
    v_entries := private.je('1200', v_cost) || private.je('5010', -v_cost);
  end if;

  v_tx := private.insert_tx(p_shop_id, jsonb_build_object(
      'type', 'adjustment', 'supplier_name', v_reason,
      'subtotal_paisa', v_cost, 'discount_paisa', 0, 'total_paisa', v_cost,
      'cash_paid_paisa', 0, 'credit_paisa', 0),
    v_entries, v_key, coalesce(p_payload->'audit_meta', '{}'::jsonb) || jsonb_build_object('reason', v_reason, 'delta_base_units', v_delta),
    v_actor, v_at);

  insert into public.transaction_lines (transaction_id, shop_id, product_id, name_snapshot, base_unit, qty_base_units,
    unit_price_paisa, pack_size_base_units, line_total_paisa, cost_total_paisa, value_first, spoken)
  values ((v_tx->>'id')::uuid, p_shop_id, v_prod.id, v_prod.name, v_prod.base_unit, abs(v_delta),
    v_unit_cost, v_prod.pack_size_base_units, v_cost, v_cost, false, v_reason);

  insert into public.inventory_movements (shop_id, product_id, transaction_id, delta_base_units, reason, created_at)
  values (p_shop_id, v_prod.id, (v_tx->>'id')::uuid, v_delta, 'adjustment', v_at);

  v_resp := jsonb_build_object(
    'status', 'COMMITTED', 'http', 200, 'deduplicated', false, 'duplicate_rows', 0, 'rows_for_key', 1,
    'type', 'adjustment', 'transaction_id', v_tx->'id', 'seq', v_tx->'seq',
    'prev_hash', v_tx->'prev_hash', 'entry_hash', v_tx->'entry_hash', 'created_at', v_at, 'rls_shop_id', p_shop_id,
    'totals', jsonb_build_object('total_paisa', v_cost, 'delta_base_units', v_delta),
    'journal', private.journal(v_entries), 'delta', 0, 'warnings', '[]'::jsonb,
    'rpc_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
  perform private.idem_finish(p_shop_id, v_key, (v_tx->>'id')::uuid, v_resp);
  insert into public.audit_events (shop_id, actor_id, event, payload, created_at)
  values (p_shop_id, v_actor, 'adjust_stock', jsonb_build_object('tx', v_tx->'id', 'product_id', v_prod.id, 'delta', v_delta, 'reason', v_reason), v_at);
  return v_resp;
end $$;

-- ───────────────────────────────────────────── 4. write_off_udhaar (bad debt / maafi)
create or replace function public.write_off_udhaar(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_key text := p_payload->>'idempotency_key';
  v_cached jsonb;
  v_customer uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_amt bigint := nullif(p_payload->>'amount_paisa', '')::bigint;
  v_bal bigint;
  v_reason text := coalesce(nullif(trim(p_payload->>'reason'), ''), 'bad-debt-maaf');
  v_entries jsonb; v_tx jsonb; v_resp jsonb;
  v_actor uuid := (select auth.uid()); v_at timestamptz := now();
begin
  perform private.assert_member(p_shop_id);
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.lock_shop(p_shop_id);
  v_cached := private.idem_begin(p_shop_id, v_key, 'write_off_udhaar');
  if v_cached is not null then return v_cached; end if;

  if v_customer is null then raise exception 'UDHAAR_REQUIRES_CUSTOMER'; end if;
  select c.balance_paisa into v_bal from public.customers c where c.id = v_customer and c.shop_id = p_shop_id;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  if v_amt is null or v_amt <= 0 or v_amt > greatest(v_bal, 0) then raise exception 'INVALID_AMOUNT'; end if;

  v_entries := private.je('4090', v_amt) || private.je('1120', -v_amt, v_customer);
  v_tx := private.insert_tx(p_shop_id, jsonb_build_object(
      'type', 'writeoff', 'customer_id', v_customer,
      'subtotal_paisa', v_amt, 'discount_paisa', v_amt, 'total_paisa', v_amt,
      'cash_paid_paisa', 0, 'credit_paisa', -v_amt),
    v_entries, v_key, coalesce(p_payload->'audit_meta', '{}'::jsonb) || jsonb_build_object('reason', v_reason),
    v_actor, v_at);

  v_resp := jsonb_build_object(
    'status', 'COMMITTED', 'http', 200, 'deduplicated', false, 'duplicate_rows', 0, 'rows_for_key', 1,
    'type', 'writeoff', 'transaction_id', v_tx->'id', 'seq', v_tx->'seq',
    'prev_hash', v_tx->'prev_hash', 'entry_hash', v_tx->'entry_hash', 'created_at', v_at, 'rls_shop_id', p_shop_id,
    'totals', jsonb_build_object('total_paisa', v_amt, 'credit_paisa', -v_amt),
    'journal', private.journal(v_entries), 'delta', 0, 'warnings', '[]'::jsonb,
    'customer', private.customer_brief(v_customer),
    'rpc_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
  perform private.idem_finish(p_shop_id, v_key, (v_tx->>'id')::uuid, v_resp);
  insert into public.audit_events (shop_id, actor_id, event, payload, created_at)
  values (p_shop_id, v_actor, 'write_off_udhaar', jsonb_build_object('tx', v_tx->'id', 'customer_id', v_customer, 'amount', v_amt), v_at);
  return v_resp;
end $$;

-- ───────────────────────────────────────────── 5. add_product (proper RPC with optional opening stock)
create or replace function public.add_product(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_payload->>'name', ''));
  v_sku text := coalesce(nullif(trim(p_payload->>'sku_code'), ''), 'SKU-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)));
  v_unit text := coalesce(nullif(p_payload->>'base_unit', ''), 'pcs');
  v_pack bigint := greatest(coalesce((p_payload->>'pack_size_base_units')::bigint, 1), 1);
  v_price bigint := greatest(coalesce((p_payload->>'unit_price_paisa')::bigint, 0), 0);
  v_cost bigint := coalesce(nullif(p_payload->>'cost_price_paisa', '')::bigint, round(v_price * 0.85));
  v_reorder bigint := greatest(coalesce((p_payload->>'reorder_level_base_units')::bigint, 0), 0);
  v_open bigint := greatest(coalesce((p_payload->>'opening_stock_base_units')::bigint, 0), 0);
  v_prod public.products%rowtype;
  v_al text;
begin
  perform private.assert_member(p_shop_id);
  if v_name = '' then raise exception 'NAME_REQUIRED'; end if;
  if v_unit not in ('g', 'ml', 'pcs') then raise exception 'INVALID_UNIT'; end if;

  insert into public.products (shop_id, sku_code, name, name_ur, base_unit, pack_size_base_units,
    unit_price_paisa, cost_price_paisa, reorder_level_base_units, stock_base_units)
  values (p_shop_id, v_sku, v_name, nullif(trim(p_payload->>'name_ur'), ''), v_unit, v_pack,
    v_price, v_cost, v_reorder, 0)
  returning * into v_prod;

  insert into public.sku_aliases (shop_id, product_id, alias)
  values (p_shop_id, v_prod.id, lower(v_name)) on conflict (shop_id, alias) do nothing;
  if nullif(trim(p_payload->>'sku_code'), '') is not null then
    insert into public.sku_aliases (shop_id, product_id, alias)
    values (p_shop_id, v_prod.id, lower(v_sku)) on conflict (shop_id, alias) do nothing;
  end if;
  if jsonb_typeof(p_payload->'aliases') = 'array' then
    for v_al in select jsonb_array_elements_text(p_payload->'aliases') loop
      if trim(v_al) <> '' then
        insert into public.sku_aliases (shop_id, product_id, alias)
        values (p_shop_id, v_prod.id, lower(trim(v_al))) on conflict (shop_id, alias) do nothing;
      end if;
    end loop;
  end if;

  if v_open > 0 then
    insert into public.inventory_movements (shop_id, product_id, delta_base_units, reason)
    values (p_shop_id, v_prod.id, v_open, 'opening');
  end if;

  select * into v_prod from public.products where id = v_prod.id;
  return jsonb_build_object('id', v_prod.id, 'name', v_prod.name, 'sku_code', v_prod.sku_code, 'stock_base_units', v_prod.stock_base_units);
end $$;

-- ───────────────────────────────────────────── 6. Update galla_today & get_trade_summary for returns & passport_nonce
create or replace function private.galla_today(p_shop_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with live as (
    select t.* from public.transactions t
    where t.shop_id = p_shop_id and t.type in ('sale', 'payment', 'purchase', 'return') and t.created_at >= private.pkt_day_start()
      and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
  ), costs as (
    select coalesce(sum(case when tx.type = 'return' then -l.cost_total_paisa else l.cost_total_paisa end), 0) as cost
    from public.transaction_lines l join live tx on tx.id = l.transaction_id where tx.type in ('sale', 'return')
  )
  select jsonb_build_object(
    'cash_sales_paisa', coalesce(sum(cash_paid_paisa) filter (where type = 'sale'), 0)
                      - coalesce(sum(cash_paid_paisa) filter (where type = 'return'), 0),
    'sales_count', count(*) filter (where type = 'sale'),
    'cash_sales_count', count(*) filter (where type = 'sale' and credit_paisa <= 0),
    'udhaar_paisa', coalesce(sum(credit_paisa) filter (where type = 'sale' and credit_paisa > 0), 0),
    'udhaar_accounts', count(distinct customer_id) filter (where type = 'sale' and credit_paisa > 0),
    'gross_sales_paisa', coalesce(sum(total_paisa) filter (where type = 'sale'), 0)
                       - coalesce(sum(total_paisa) filter (where type = 'return'), 0),
    'wasooli_paisa', coalesce(sum(total_paisa) filter (where type = 'payment'), 0),
    'purchases_cash_paisa', coalesce(sum(cash_paid_paisa) filter (where type = 'purchase'), 0),
    'cash_in_galla_paisa', coalesce(sum(cash_paid_paisa) filter (where type = 'sale'), 0)
                         + coalesce(sum(total_paisa) filter (where type = 'payment'), 0)
                         - coalesce(sum(cash_paid_paisa) filter (where type = 'purchase'), 0)
                         - coalesce(sum(cash_paid_paisa) filter (where type = 'return'), 0),
    'est_margin_paisa', (coalesce(sum(total_paisa) filter (where type = 'sale'), 0)
                       - coalesce(sum(total_paisa) filter (where type = 'return'), 0))
                      - (select cost from costs))
  from live;
$$;

create or replace function public.get_trade_summary(p_shop_id uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := now() - make_interval(days => p_days); v jsonb; v_seq bigint; v_hash text; v_bharosa jsonb;
begin
  perform private.assert_member(p_shop_id);
  select t.seq, t.entry_hash into v_seq, v_hash from public.transactions t where t.shop_id = p_shop_id order by t.seq desc limit 1;

  with credit as (
    select t.id, t.credit_paisa, private.tx_attestation_status(t.id) st
    from public.transactions t
    where t.shop_id = p_shop_id and t.created_at >= v_from and t.type = 'sale' and t.credit_paisa > 0
      and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
  ), promises as (
    select a.customer_id, a.promise_date, a.created_at,
           exists (select 1 from public.transactions t where t.shop_id = p_shop_id and t.customer_id = a.customer_id
                   and t.type = 'payment' and t.created_at >= a.created_at
                   and (t.created_at at time zone 'Asia/Karachi')::date <= a.promise_date) kept
    from public.attestations a
    where a.shop_id = p_shop_id and a.kind = 'promise' and a.created_at >= v_from
      and a.promise_date < (now() at time zone 'Asia/Karachi')::date
  )
  select jsonb_build_object(
    'credit_entries', (select count(*) from credit),
    'credit_entries_paisa', (select coalesce(sum(credit_paisa), 0) from credit),
    'confirmed_entries', (select count(*) from credit where st = 'confirm'),
    'confirmed_paisa', (select coalesce(sum(credit_paisa), 0) from credit where st = 'confirm'),
    'disputed_entries', (select count(*) from credit where st = 'dispute'),
    'promises_due', (select count(*) from promises),
    'promises_kept', (select count(*) from promises where kept),
    'attestations_total', (select count(*) from public.attestations a where a.shop_id = p_shop_id and a.source = 'customer'),
    'attestation_head_hash', coalesce((select a.entry_hash from public.attestations a where a.shop_id = p_shop_id order by a.seq desc limit 1),
                                      private.genesis_hash())
  ) into v_bharosa;

  with live as (
    select t.* from public.transactions t
    where t.shop_id = p_shop_id and t.created_at >= v_from and t.type in ('sale', 'payment', 'purchase', 'return')
      and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
  )
  select jsonb_build_object(
    'shop_id', s.id, 'shop_name', s.name, 'city', s.city, 'passport_nonce', s.passport_nonce,
    'active_days', greatest(1, floor(extract(epoch from now() - s.active_since) / 86400)::int),
    'period_days', p_days, 'period_from', v_from, 'period_to', now(),
    'gmv_paisa', greatest(0, (select coalesce(sum(total_paisa), 0) from live where type = 'sale')
                           - (select coalesce(sum(total_paisa), 0) from live where type = 'return')),
    'sales_count', (select count(*) from live where type = 'sale'),
    'cash_sales_paisa', greatest(0, (select coalesce(sum(cash_paid_paisa), 0) from live where type = 'sale')
                                  - (select coalesce(sum(cash_paid_paisa), 0) from live where type = 'return')),
    'credit_sales_paisa', (select coalesce(sum(greatest(credit_paisa, 0)), 0) from live where type = 'sale'),
    'recovered_paisa', (select coalesce(sum(total_paisa), 0) from live where type = 'payment')
                      + (select coalesce(sum(-least(credit_paisa, 0)), 0) from live where type = 'sale'),
    'purchases_paisa', (select coalesce(sum(total_paisa), 0) from live where type = 'purchase'),
    'active_trading_days', (select count(distinct (created_at at time zone 'Asia/Karachi')::date) from live where type = 'sale'),
    'receivable_paisa', (select coalesce(sum(balance_paisa), 0) from public.customers where shop_id = p_shop_id and balance_paisa > 0),
    'ledger_balanced', (select coalesce(sum(amount_paisa), 0) = 0 from public.ledger_entries where shop_id = p_shop_id),
    'tx_count_total', coalesce(v_seq, 0),
    'head_entry_hash', coalesce(v_hash, private.genesis_hash()),
    'bharosa', v_bharosa
  ) into v
  from public.shops s where s.id = p_shop_id;
  return v;
end $$;

-- ───────────────────────────────────────────── 7. get_shop_insights (Daily / Weekly / Monthly P&L)
create or replace function public.get_shop_insights(p_shop_id uuid, p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_days int := greatest(1, least(coalesce(p_days, 7), 90));
  v_from timestamptz := case
    when v_days = 1 then private.pkt_day_start()
    else (private.pkt_day_start() - make_interval(days => v_days - 1))
  end;
  v jsonb;
begin
  perform private.assert_member(p_shop_id);

  with live as (
    select t.* from public.transactions t
    where t.shop_id = p_shop_id and t.created_at >= v_from
      and t.type in ('sale', 'payment', 'purchase', 'return', 'adjustment', 'writeoff')
      and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
  ), sale_lines as (
    select tl.product_id, tl.name_snapshot, tl.base_unit,
           sum(case when tx.type = 'return' then -tl.qty_base_units else tl.qty_base_units end)::bigint as net_qty,
           sum(case when tx.type = 'return' then -tl.line_total_paisa else tl.line_total_paisa end)::bigint as net_rev_paisa,
           sum(case when tx.type = 'return' then -tl.cost_total_paisa else tl.cost_total_paisa end)::bigint as net_cost_paisa
    from public.transaction_lines tl
    join live tx on tx.id = tl.transaction_id
    where tx.type in ('sale', 'return') and tl.product_id is not null
    group by tl.product_id, tl.name_snapshot, tl.base_unit
  ), daily as (
    select ((tx.created_at at time zone 'Asia/Karachi')::date)::text as day,
           coalesce(sum(tx.total_paisa) filter (where tx.type = 'sale'), 0)
         - coalesce(sum(tx.total_paisa) filter (where tx.type = 'return'), 0) as sales_paisa,
           coalesce(sum(tx.cash_paid_paisa) filter (where tx.type = 'sale'), 0)
         + coalesce(sum(tx.total_paisa) filter (where tx.type = 'payment'), 0)
         - coalesce(sum(tx.cash_paid_paisa) filter (where tx.type = 'return'), 0) as cash_in_paisa,
           count(*) filter (where tx.type = 'sale') as sales_count
    from live tx
    group by 1
    order by 1
  ), top_cust as (
    select c.id, c.name, c.role_tag, c.balance_paisa,
           coalesce(sum(tx.total_paisa) filter (where tx.type = 'sale'), 0)::bigint as spent_paisa,
           count(*) filter (where tx.type = 'sale') as visits
    from public.customers c
    left join live tx on tx.customer_id = c.id
    where c.shop_id = p_shop_id
    group by c.id, c.name, c.role_tag, c.balance_paisa
    having coalesce(sum(tx.total_paisa) filter (where tx.type = 'sale'), 0) > 0 or c.balance_paisa > 0
    order by spent_paisa desc, c.balance_paisa desc
    limit 5
  ), slow_items as (
    select p.id, p.name, p.base_unit, p.stock_base_units, p.unit_price_paisa,
           coalesce(sl.net_qty, 0)::bigint as sold_qty
    from public.products p
    left join sale_lines sl on sl.product_id = p.id
    where p.shop_id = p_shop_id and p.stock_base_units > 0
    order by coalesce(sl.net_qty, 0) asc, p.stock_base_units desc
    limit 5
  )
  select jsonb_build_object(
    'period_days', v_days,
    'period_from', v_from,
    'summary', jsonb_build_object(
      'gross_sales_paisa', coalesce((select sum(total_paisa) from live where type = 'sale'), 0),
      'returns_paisa', coalesce((select sum(total_paisa) from live where type = 'return'), 0),
      'discounts_paisa', coalesce((select sum(discount_paisa) from live where type = 'sale'), 0),
      'net_revenue_paisa', coalesce((select sum(total_paisa) from live where type = 'sale'), 0)
                         - coalesce((select sum(total_paisa) from live where type = 'return'), 0),
      'cogs_paisa', coalesce((select sum(net_cost_paisa) from sale_lines), 0),
      'gross_profit_paisa', (coalesce((select sum(total_paisa) from live where type = 'sale'), 0)
                           - coalesce((select sum(total_paisa) from live where type = 'return'), 0))
                          - coalesce((select sum(net_cost_paisa) from sale_lines), 0),
      'cash_sales_paisa', coalesce((select sum(cash_paid_paisa) from live where type = 'sale'), 0)
                        - coalesce((select sum(cash_paid_paisa) from live where type = 'return'), 0),
      'credit_sales_paisa', coalesce((select sum(greatest(credit_paisa, 0)) from live where type = 'sale'), 0),
      'wasooli_paisa', coalesce((select sum(total_paisa) from live where type = 'payment'), 0),
      'purchases_paisa', coalesce((select sum(total_paisa) from live where type = 'purchase'), 0),
      'wastage_paisa', coalesce((select sum(total_paisa) from live where type = 'adjustment'), 0),
      'writeoff_paisa', coalesce((select sum(total_paisa) from live where type = 'writeoff'), 0),
      'sales_count', (select count(*) from live where type = 'sale')
    ),
    'daily', coalesce((select jsonb_agg(to_jsonb(d)) from daily d), '[]'::jsonb),
    'top_customers', coalesce((select jsonb_agg(to_jsonb(tc)) from top_cust tc), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', sl.product_id, 'name', sl.name_snapshot, 'base_unit', sl.base_unit,
        'qty', sl.net_qty, 'revenue_paisa', sl.net_rev_paisa, 'profit_paisa', sl.net_rev_paisa - sl.net_cost_paisa
      ) order by sl.net_rev_paisa desc)
      from (select * from sale_lines order by net_rev_paisa desc limit 5) sl
    ), '[]'::jsonb),
    'slow_products', coalesce((select jsonb_agg(to_jsonb(si)) from slow_items si), '[]'::jsonb),
    'sql_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2)
  ) into v;
  return v;
end $$;

-- ───────────────────────────────────────────── 8. grants
revoke all on function private.record_return_core(uuid, jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.rotate_passport_tokens(uuid) from public, anon;
grant execute on function public.rotate_passport_tokens(uuid) to authenticated, service_role;
revoke all on function public.record_return(uuid, jsonb) from public, anon;
grant execute on function public.record_return(uuid, jsonb) to authenticated, service_role;
revoke all on function public.adjust_stock(uuid, jsonb) from public, anon;
grant execute on function public.adjust_stock(uuid, jsonb) to authenticated, service_role;
revoke all on function public.write_off_udhaar(uuid, jsonb) from public, anon;
grant execute on function public.write_off_udhaar(uuid, jsonb) to authenticated, service_role;
revoke all on function public.add_product(uuid, jsonb) from public, anon;
grant execute on function public.add_product(uuid, jsonb) to authenticated, service_role;
revoke all on function public.get_shop_insights(uuid, int) from public, anon;
grant execute on function public.get_shop_insights(uuid, int) to authenticated, service_role;
