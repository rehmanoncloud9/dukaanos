-- DukaanOS · 0002 · Atomic hash-chained RPCs, Munshi Pulse, chain verifier, trade summary
-- Every financial write: advisory lock → in-RPC idempotency → server-side integer math →
-- balanced double entry (deferred SUM=0) → SHA-256 prev_hash/entry_hash → X-Ray JSONB.

-- ═════════════════════════════════════════════ helpers

create or replace function private.account_name(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case p_code
    when '1010' then 'Cash' when '1120' then 'A/R' when '1200' then 'Inventory'
    when '2010' then 'A/P' when '4010' then 'Sales' when '4090' then 'Sales Discount'
    when '5010' then 'COGS' else p_code end;
$$;

create or replace function private.ts_text(p_at timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- canonical digest of planned entries (jsonb) — must equal ledger_digest_tx of the stored rows
create or replace function private.ledger_digest_json(p_entries jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(
    format('%s:%s:%s', e->>'account_code', coalesce(e->>'customer_id', '-'), (e->>'amount_paisa')::bigint), ','
    order by e->>'account_code', coalesce(e->>'customer_id', '-'), (e->>'amount_paisa')::bigint), '')
  from jsonb_array_elements(p_entries) e;
$$;

create or replace function private.ledger_digest_tx(p_tx uuid) returns text
language sql stable set search_path = '' as $$
  select coalesce(string_agg(
    format('%s:%s:%s', account_code, coalesce(customer_id::text, '-'), amount_paisa), ','
    order by account_code, coalesce(customer_id::text, '-'), amount_paisa), '')
  from public.ledger_entries where transaction_id = p_tx;
$$;

-- entry_hash = sha256(prev_hash | tx_id | type | total | timestamp | ledger digest)
create or replace function private.entry_hash(p_prev text, p_tx uuid, p_type text, p_total bigint, p_at timestamptz, p_digest text) returns text
language sql stable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|', p_prev, p_tx::text, p_type, p_total::text, private.ts_text(p_at), p_digest), 'UTF8')), 'hex');
$$;

create or replace function private.genesis_hash() returns text
language sql immutable set search_path = '' as $$ select repeat('0', 64); $$;

create or replace function private.je(p_code text, p_amount bigint, p_customer uuid default null) returns jsonb
language sql immutable set search_path = '' as $$
  select case when coalesce(p_amount, 0) = 0 then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('account_code', p_code, 'amount_paisa', p_amount, 'customer_id', p_customer)) end;
$$;

create or replace function private.journal(p_entries jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_code', e->>'account_code',
      'account_name', private.account_name(e->>'account_code'),
      'side', case when (e->>'amount_paisa')::bigint > 0 then 'DR' else 'CR' end,
      'amount_paisa', abs((e->>'amount_paisa')::bigint),
      'customer_id', e->'customer_id')
    order by case when (e->>'amount_paisa')::bigint > 0 then 0 else 1 end, e->>'account_code'), '[]'::jsonb)
  from jsonb_array_elements(p_entries) e;
$$;

create or replace function private.assert_member(p_shop_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then return; end if;
  -- trusted direct DB session (migrations, seed, ops scripts): PostgREST always sets JWT claims, so
  -- any API request — anon or authenticated — falls through to the membership check.
  if nullif(current_setting('request.jwt.claims', true), '') is null
     and nullif(current_setting('request.jwt.claim.sub', true), '') is null
     and current_user not in ('anon', 'authenticated') then
    return;
  end if;
  if not public.is_shop_member(p_shop_id) then
    raise exception 'FORBIDDEN: not a member of this shop' using errcode = '42501';
  end if;
end $$;

create or replace function private.lock_shop(p_shop_id uuid) returns void
language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(p_shop_id::text, 42));
$$;

-- returns NULL when this key is new; otherwise the cached response flagged as deduplicated
create or replace function private.idem_begin(p_shop_id uuid, p_key text, p_rpc text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_rows bigint;
begin
  insert into public.idempotency_keys (shop_id, idempotency_key, rpc) values (p_shop_id, p_key, p_rpc)
  on conflict do nothing;
  if found then return null; end if;
  select response into v from public.idempotency_keys where shop_id = p_shop_id and idempotency_key = p_key;
  select count(*) into v_rows from public.transactions where shop_id = p_shop_id and idempotency_key = p_key;
  return coalesce(v, '{}'::jsonb) || jsonb_build_object(
    'deduplicated', true, 'status', 'REPLAY_DEDUPLICATED', 'http', 200,
    'rows_for_key', v_rows, 'duplicate_rows', greatest(v_rows - 1, 0));
end $$;

create or replace function private.idem_finish(p_shop_id uuid, p_key text, p_tx uuid, p_resp jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.idempotency_keys set response = p_resp, transaction_id = p_tx
  where shop_id = p_shop_id and idempotency_key = p_key;
$$;

-- Insert a hash-chained transaction + its ledger entries. Returns {id, seq, prev_hash, entry_hash}.
create or replace function private.insert_tx(
  p_shop_id uuid, p_tx jsonb, p_entries jsonb, p_key text, p_meta jsonb, p_actor uuid, p_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_seq bigint; v_prev text; v_hash text; v_sum bigint;
begin
  select coalesce(sum((e->>'amount_paisa')::bigint), 0) into v_sum from jsonb_array_elements(p_entries) e;
  if v_sum <> 0 then raise exception 'LEDGER_UNBALANCED: planned entries sum to %', v_sum; end if;
  if jsonb_array_length(p_entries) = 0 then raise exception 'EMPTY_JOURNAL'; end if;

  select t.seq, t.entry_hash into v_seq, v_prev
  from public.transactions t where t.shop_id = p_shop_id order by t.seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, private.genesis_hash());
  v_hash := private.entry_hash(v_prev, v_id, p_tx->>'type', (p_tx->>'total_paisa')::bigint, p_at, private.ledger_digest_json(p_entries));

  insert into public.transactions (
    id, shop_id, seq, type, customer_id, supplier_name, reversed_transaction_id,
    subtotal_paisa, discount_paisa, total_paisa, cash_paid_paisa, credit_paisa,
    idempotency_key, prev_hash, entry_hash, audit_meta, actor_id, created_at
  ) values (
    v_id, p_shop_id, v_seq, p_tx->>'type', nullif(p_tx->>'customer_id', '')::uuid, p_tx->>'supplier_name',
    nullif(p_tx->>'reversed_transaction_id', '')::uuid,
    coalesce((p_tx->>'subtotal_paisa')::bigint, 0), coalesce((p_tx->>'discount_paisa')::bigint, 0),
    coalesce((p_tx->>'total_paisa')::bigint, 0), coalesce((p_tx->>'cash_paid_paisa')::bigint, 0),
    coalesce((p_tx->>'credit_paisa')::bigint, 0),
    p_key, v_prev, v_hash, coalesce(p_meta, '{}'::jsonb), p_actor, p_at
  );

  insert into public.ledger_entries (transaction_id, shop_id, account_code, customer_id, amount_paisa, created_at)
  select v_id, p_shop_id, e->>'account_code', nullif(e->>'customer_id', '')::uuid, (e->>'amount_paisa')::bigint, p_at
  from jsonb_array_elements(p_entries) e;

  return jsonb_build_object('id', v_id, 'seq', v_seq, 'prev_hash', v_prev, 'entry_hash', v_hash);
end $$;

create or replace function private.customer_brief(p_customer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'role_tag', c.role_tag, 'phone', c.phone,
                            'balance_paisa', c.balance_paisa, 'last_paid_at', c.last_paid_at)
  from public.customers c where c.id = p_customer;
$$;

-- ═════════════════════════════════════════════ commit_sale

create or replace function private.commit_sale_core(p_shop_id uuid, p_payload jsonb, p_actor uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_key text := p_payload->>'idempotency_key';
  v_cached jsonb;
  v_line jsonb; v_new jsonb; v_prod public.products%rowtype; v_code text;
  v_qty bigint; v_total bigint; v_cost bigint; v_value bigint; v_is_new boolean;
  v_lines jsonb := '[]'::jsonb; v_sub bigint := 0; v_cost_sum bigint := 0;
  v_disc bigint; v_cash bigint; v_net bigint; v_credit bigint; v_change bigint := 0;
  v_customer uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_entries jsonb := '[]'::jsonb; v_tx jsonb; v_warn jsonb; v_resp jsonb; v_l jsonb;
begin
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.lock_shop(p_shop_id);
  v_cached := private.idem_begin(p_shop_id, v_key, 'commit_sale');
  if v_cached is not null then return v_cached; end if;

  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'NO_ITEMS';
  end if;
  if v_customer is not null and not exists (select 1 from public.customers where id = v_customer and shop_id = p_shop_id) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    v_new := v_line->'new_sku';
    v_is_new := v_new is not null and jsonb_typeof(v_new) = 'object';
    if v_is_new then
      -- QuickAddChip: SKU is created atomically inside the same transaction as the sale
      v_code := 'QA-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      insert into public.products (shop_id, sku_code, name, base_unit, pack_size_base_units, unit_price_paisa,
                                   cost_price_paisa, is_quick_added, created_at)
      values (p_shop_id, v_code, coalesce(nullif(trim(v_new->>'name'), ''), 'New Item'),
              coalesce(v_new->>'base_unit', 'pcs'),
              greatest(coalesce((v_new->>'pack_size_base_units')::bigint, 1), 1),
              greatest(coalesce((v_new->>'unit_price_paisa')::bigint, 0), 0),
              greatest(coalesce((v_new->>'cost_price_paisa')::bigint, 0), 0), true, p_at)
      returning * into v_prod;
      if coalesce(v_line->>'spoken', '') <> '' then
        insert into public.sku_aliases (shop_id, product_id, alias)
        values (p_shop_id, v_prod.id, lower(trim(v_line->>'spoken'))) on conflict do nothing;
      end if;
    else
      select * into v_prod from public.products
      where id = nullif(v_line->>'product_id', '')::uuid and shop_id = p_shop_id for update;
      if not found then raise exception 'PRODUCT_NOT_FOUND: %', v_line->>'product_id'; end if;
    end if;

    v_value := nullif(v_line->>'value_paisa', '')::bigint;
    if v_value is not null and v_value > 0 then
      if v_prod.unit_price_paisa <= 0 then raise exception 'PRICE_REQUIRED: %', v_prod.name; end if;
      v_qty := greatest(1, round(v_value::numeric * v_prod.pack_size_base_units / v_prod.unit_price_paisa));
      v_total := v_value;
    else
      v_qty := nullif(v_line->>'qty_base_units', '')::bigint;
      if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY: %', v_prod.name; end if;
      v_total := round(v_qty::numeric * v_prod.unit_price_paisa / v_prod.pack_size_base_units);
    end if;
    v_cost := round(v_qty::numeric * v_prod.cost_price_paisa / v_prod.pack_size_base_units);
    v_sub := v_sub + v_total;
    v_cost_sum := v_cost_sum + v_cost;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'base_unit', v_prod.base_unit,
      'qty_base_units', v_qty, 'unit_price_paisa', v_prod.unit_price_paisa,
      'pack_size_base_units', v_prod.pack_size_base_units, 'line_total_paisa', v_total,
      'cost_total_paisa', v_cost, 'value_first', (v_value is not null and v_value > 0),
      'spoken', v_line->>'spoken', 'quick_added', v_is_new));
  end loop;

  v_disc := least(greatest(coalesce(nullif(p_payload->>'discount_paisa', '')::bigint, 0), 0), v_sub);
  v_net := v_sub - v_disc;
  v_cash := greatest(coalesce(nullif(p_payload->>'cash_paid_paisa', '')::bigint, v_net), 0);
  if v_customer is null and v_cash > v_net then
    v_change := v_cash - v_net;
    v_cash := v_net;
  end if;
  v_credit := v_net - v_cash;
  if v_credit <> 0 and v_customer is null then
    raise exception 'UDHAAR_REQUIRES_CUSTOMER' using hint = 'Pick or add a customer before saving udhaar';
  end if;

  v_entries := private.je('1010', v_cash)
            || private.je('1120', v_credit, v_customer)
            || private.je('4090', v_disc)
            || private.je('4010', -v_sub)
            || private.je('5010', v_cost_sum)
            || private.je('1200', -v_cost_sum);

  v_tx := private.insert_tx(p_shop_id, jsonb_build_object(
      'type', 'sale', 'customer_id', v_customer, 'subtotal_paisa', v_sub, 'discount_paisa', v_disc,
      'total_paisa', v_net, 'cash_paid_paisa', v_cash, 'credit_paisa', v_credit),
    v_entries, v_key, coalesce(p_payload->'audit_meta', '{}'::jsonb), p_actor, p_at);

  for v_l in select value from jsonb_array_elements(v_lines) loop
    insert into public.transaction_lines (transaction_id, shop_id, product_id, name_snapshot, base_unit, qty_base_units,
      unit_price_paisa, pack_size_base_units, line_total_paisa, cost_total_paisa, value_first, spoken)
    values ((v_tx->>'id')::uuid, p_shop_id, (v_l->>'product_id')::uuid, v_l->>'name', v_l->>'base_unit',
      (v_l->>'qty_base_units')::bigint, (v_l->>'unit_price_paisa')::bigint, (v_l->>'pack_size_base_units')::bigint,
      (v_l->>'line_total_paisa')::bigint, (v_l->>'cost_total_paisa')::bigint, (v_l->>'value_first')::boolean, v_l->>'spoken');
    insert into public.inventory_movements (shop_id, product_id, transaction_id, delta_base_units, reason, created_at)
    values (p_shop_id, (v_l->>'product_id')::uuid, (v_tx->>'id')::uuid, -(v_l->>'qty_base_units')::bigint, 'sale', p_at);
  end loop;

  -- soft NEGATIVE_STOCK warnings (never blocks the counter)
  select coalesce(jsonb_agg(jsonb_build_object('code', 'NEGATIVE_STOCK', 'product_id', p.id, 'name', p.name,
           'stock_after', p.stock_base_units, 'base_unit', p.base_unit)), '[]'::jsonb)
  into v_warn
  from public.products p
  where p.shop_id = p_shop_id and p.stock_base_units < 0 and not p.is_quick_added
    and p.id in (select (value->>'product_id')::uuid from jsonb_array_elements(v_lines));

  v_resp := jsonb_build_object(
    'status', 'COMMITTED', 'http', 200, 'deduplicated', false, 'duplicate_rows', 0, 'rows_for_key', 1,
    'type', 'sale', 'transaction_id', v_tx->'id', 'seq', v_tx->'seq',
    'prev_hash', v_tx->'prev_hash', 'entry_hash', v_tx->'entry_hash',
    'created_at', p_at, 'rls_shop_id', p_shop_id,
    'totals', jsonb_build_object('subtotal_paisa', v_sub, 'discount_paisa', v_disc, 'total_paisa', v_net,
                                 'cash_paid_paisa', v_cash, 'credit_paisa', v_credit, 'change_due_paisa', v_change,
                                 'cost_paisa', v_cost_sum, 'margin_paisa', v_net - v_cost_sum),
    'lines', v_lines, 'journal', private.journal(v_entries), 'delta', 0,
    'warnings', v_warn,
    'customer', case when v_customer is not null then private.customer_brief(v_customer) end,
    'rpc_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));

  perform private.idem_finish(p_shop_id, v_key, (v_tx->>'id')::uuid, v_resp);
  insert into public.audit_events (shop_id, actor_id, event, payload, created_at)
  values (p_shop_id, p_actor, 'commit_sale', jsonb_build_object('tx', v_tx->'id', 'total', v_net, 'credit', v_credit), p_at);
  return v_resp;
end $$;

create or replace function public.commit_sale(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return private.commit_sale_core(p_shop_id, p_payload, (select auth.uid()), now());
end $$;

-- ═════════════════════════════════════════════ record_payment (Wasooli)

create or replace function private.record_payment_core(p_shop_id uuid, p_payload jsonb, p_actor uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_key text := p_payload->>'idempotency_key';
  v_cached jsonb; v_entries jsonb; v_tx jsonb; v_resp jsonb;
  v_customer uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_amt bigint := nullif(p_payload->>'amount_paisa', '')::bigint;
begin
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.lock_shop(p_shop_id);
  v_cached := private.idem_begin(p_shop_id, v_key, 'record_payment');
  if v_cached is not null then return v_cached; end if;

  if v_customer is null then raise exception 'UDHAAR_REQUIRES_CUSTOMER'; end if;
  if not exists (select 1 from public.customers where id = v_customer and shop_id = p_shop_id) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;
  if v_amt is null or v_amt <= 0 then raise exception 'INVALID_AMOUNT'; end if;

  v_entries := private.je('1010', v_amt) || private.je('1120', -v_amt, v_customer);
  v_tx := private.insert_tx(p_shop_id, jsonb_build_object(
      'type', 'payment', 'customer_id', v_customer, 'subtotal_paisa', v_amt, 'total_paisa', v_amt,
      'cash_paid_paisa', v_amt, 'credit_paisa', -v_amt),
    v_entries, v_key, coalesce(p_payload->'audit_meta', '{}'::jsonb), p_actor, p_at);

  update public.customers set last_paid_at = greatest(coalesce(last_paid_at, p_at), p_at) where id = v_customer;

  v_resp := jsonb_build_object(
    'status', 'COMMITTED', 'http', 200, 'deduplicated', false, 'duplicate_rows', 0, 'rows_for_key', 1,
    'type', 'payment', 'transaction_id', v_tx->'id', 'seq', v_tx->'seq',
    'prev_hash', v_tx->'prev_hash', 'entry_hash', v_tx->'entry_hash', 'created_at', p_at, 'rls_shop_id', p_shop_id,
    'totals', jsonb_build_object('total_paisa', v_amt, 'cash_paid_paisa', v_amt, 'credit_paisa', -v_amt),
    'journal', private.journal(v_entries), 'delta', 0, 'warnings', '[]'::jsonb,
    'customer', private.customer_brief(v_customer),
    'rpc_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
  perform private.idem_finish(p_shop_id, v_key, (v_tx->>'id')::uuid, v_resp);
  insert into public.audit_events (shop_id, actor_id, event, payload, created_at)
  values (p_shop_id, p_actor, 'record_payment', jsonb_build_object('tx', v_tx->'id', 'amount', v_amt), p_at);
  return v_resp;
end $$;

create or replace function public.record_payment(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return private.record_payment_core(p_shop_id, p_payload, (select auth.uid()), now());
end $$;

-- ═════════════════════════════════════════════ record_purchase (Parchi restock)

create or replace function private.record_purchase_core(p_shop_id uuid, p_payload jsonb, p_actor uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_key text := p_payload->>'idempotency_key';
  v_cached jsonb; v_line jsonb; v_new jsonb; v_prod public.products%rowtype; v_code text;
  v_qty bigint; v_lt bigint; v_total bigint := 0; v_cash bigint; v_ap bigint; v_pack bigint;
  v_lines jsonb := '[]'::jsonb; v_entries jsonb; v_tx jsonb; v_resp jsonb; v_l jsonb; v_is_new boolean;
  v_stated bigint := nullif(p_payload->>'stated_total_paisa', '')::bigint;
  v_new_count int := 0;
begin
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.lock_shop(p_shop_id);
  v_cached := private.idem_begin(p_shop_id, v_key, 'record_purchase');
  if v_cached is not null then return v_cached; end if;

  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') = 0 then
    raise exception 'NO_ITEMS';
  end if;

  for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
    v_qty := nullif(v_line->>'qty_base_units', '')::bigint;
    v_lt := nullif(v_line->>'line_total_paisa', '')::bigint;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QTY'; end if;
    if v_lt is null or v_lt < 0 then raise exception 'INVALID_AMOUNT'; end if;
    v_new := v_line->'new_sku';
    v_is_new := v_new is not null and jsonb_typeof(v_new) = 'object';
    if v_is_new then
      v_pack := greatest(coalesce((v_new->>'pack_size_base_units')::bigint, 1), 1);
      v_code := 'NEW-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      insert into public.products (shop_id, sku_code, name, base_unit, pack_size_base_units, unit_price_paisa,
                                   cost_price_paisa, reorder_level_base_units, is_quick_added, created_at)
      values (p_shop_id, v_code, coalesce(nullif(trim(v_new->>'name'), ''), 'New Item'),
              coalesce(v_new->>'base_unit', 'pcs'), v_pack,
              -- sell price: as given, else cost + 12% rounded to the rupee
              greatest(coalesce(nullif(v_new->>'unit_price_paisa', '')::bigint,
                       (round(v_lt::numeric * v_pack / v_qty * 1.12 / 100) * 100)::bigint), 0),
              round(v_lt::numeric * v_pack / v_qty), 0, false, p_at)
      returning * into v_prod;
      v_new_count := v_new_count + 1;
      if coalesce(v_line->>'spoken', '') <> '' then
        insert into public.sku_aliases (shop_id, product_id, alias)
        values (p_shop_id, v_prod.id, lower(trim(v_line->>'spoken'))) on conflict do nothing;
      end if;
    else
      select * into v_prod from public.products
      where id = nullif(v_line->>'product_id', '')::uuid and shop_id = p_shop_id for update;
      if not found then raise exception 'PRODUCT_NOT_FOUND: %', v_line->>'product_id'; end if;
      update public.products set cost_price_paisa = round(v_lt::numeric * v_prod.pack_size_base_units / v_qty)
      where id = v_prod.id;
    end if;
    v_total := v_total + v_lt;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'base_unit', v_prod.base_unit, 'qty_base_units', v_qty,
      'pack_size_base_units', v_prod.pack_size_base_units,
      'unit_cost_paisa', round(v_lt::numeric * v_prod.pack_size_base_units / v_qty),
      'line_total_paisa', v_lt, 'new_sku', v_is_new, 'spoken', v_line->>'spoken'));
  end loop;

  if v_total <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  v_cash := least(greatest(coalesce(nullif(p_payload->>'cash_paid_paisa', '')::bigint, v_total), 0), v_total);
  v_ap := v_total - v_cash;
  v_entries := private.je('1200', v_total) || private.je('1010', -v_cash) || private.je('2010', -v_ap);

  v_tx := private.insert_tx(p_shop_id, jsonb_build_object(
      'type', 'purchase', 'supplier_name', coalesce(p_payload->>'supplier_name', 'Wholesale'),
      'subtotal_paisa', v_total, 'total_paisa', v_total, 'cash_paid_paisa', v_cash, 'credit_paisa', v_ap),
    v_entries, v_key, coalesce(p_payload->'audit_meta', '{}'::jsonb), p_actor, p_at);

  for v_l in select value from jsonb_array_elements(v_lines) loop
    insert into public.transaction_lines (transaction_id, shop_id, product_id, name_snapshot, base_unit, qty_base_units,
      unit_price_paisa, pack_size_base_units, line_total_paisa, cost_total_paisa, value_first, spoken)
    values ((v_tx->>'id')::uuid, p_shop_id, (v_l->>'product_id')::uuid, v_l->>'name', v_l->>'base_unit',
      (v_l->>'qty_base_units')::bigint, (v_l->>'unit_cost_paisa')::bigint, (v_l->>'pack_size_base_units')::bigint,
      (v_l->>'line_total_paisa')::bigint, (v_l->>'line_total_paisa')::bigint, false, v_l->>'spoken');
    insert into public.inventory_movements (shop_id, product_id, transaction_id, delta_base_units, reason, created_at)
    values (p_shop_id, (v_l->>'product_id')::uuid, (v_tx->>'id')::uuid, (v_l->>'qty_base_units')::bigint, 'purchase', p_at);
  end loop;

  v_resp := jsonb_build_object(
    'status', 'COMMITTED', 'http', 200, 'deduplicated', false, 'duplicate_rows', 0, 'rows_for_key', 1,
    'type', 'purchase', 'transaction_id', v_tx->'id', 'seq', v_tx->'seq',
    'prev_hash', v_tx->'prev_hash', 'entry_hash', v_tx->'entry_hash', 'created_at', p_at, 'rls_shop_id', p_shop_id,
    'totals', jsonb_build_object('total_paisa', v_total, 'cash_paid_paisa', v_cash, 'credit_paisa', v_ap),
    'math_check', jsonb_build_object('stated_total_paisa', v_stated, 'computed_total_paisa', v_total,
                                     'passed', v_stated is null or v_stated = v_total,
                                     'delta_paisa', coalesce(v_stated - v_total, 0)),
    'new_skus', v_new_count, 'lines', v_lines, 'journal', private.journal(v_entries), 'delta', 0,
    'warnings', '[]'::jsonb,
    'rpc_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
  perform private.idem_finish(p_shop_id, v_key, (v_tx->>'id')::uuid, v_resp);
  insert into public.audit_events (shop_id, actor_id, event, payload, created_at)
  values (p_shop_id, p_actor, 'record_purchase', jsonb_build_object('tx', v_tx->'id', 'total', v_total, 'new_skus', v_new_count), p_at);
  return v_resp;
end $$;

create or replace function public.record_purchase(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return private.record_purchase_core(p_shop_id, p_payload, (select auth.uid()), now());
end $$;

-- ═════════════════════════════════════════════ reverse_transaction (Undo / wapas)

create or replace function private.reverse_transaction_core(p_shop_id uuid, p_payload jsonb, p_actor uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  v_key text := p_payload->>'idempotency_key';
  v_target uuid := nullif(p_payload->>'transaction_id', '')::uuid;
  v_cached jsonb; v_orig public.transactions%rowtype; v_entries jsonb; v_tx jsonb; v_resp jsonb;
begin
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  perform private.lock_shop(p_shop_id);
  v_cached := private.idem_begin(p_shop_id, v_key, 'reverse_transaction');
  if v_cached is not null then return v_cached; end if;

  if v_target is null then
    -- "Pichli entry wapas kar do": latest non-reversed, non-reversal transaction
    select t.* into v_orig from public.transactions t
    where t.shop_id = p_shop_id and t.type <> 'reversal'
      and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
    order by t.seq desc limit 1;
  else
    select * into v_orig from public.transactions where id = v_target and shop_id = p_shop_id;
  end if;
  if v_orig.id is null then raise exception 'TX_NOT_FOUND'; end if;
  if v_orig.type = 'reversal' then raise exception 'CANNOT_REVERSE_REVERSAL'; end if;
  if exists (select 1 from public.transactions where reversed_transaction_id = v_orig.id) then
    raise exception 'ALREADY_REVERSED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('account_code', account_code, 'amount_paisa', -amount_paisa,
                                               'customer_id', customer_id)), '[]'::jsonb)
  into v_entries from public.ledger_entries where transaction_id = v_orig.id;

  v_tx := private.insert_tx(p_shop_id, jsonb_build_object(
      'type', 'reversal', 'customer_id', v_orig.customer_id, 'supplier_name', v_orig.supplier_name,
      'reversed_transaction_id', v_orig.id, 'subtotal_paisa', -v_orig.subtotal_paisa,
      'discount_paisa', -v_orig.discount_paisa, 'total_paisa', -v_orig.total_paisa,
      'cash_paid_paisa', -v_orig.cash_paid_paisa, 'credit_paisa', -v_orig.credit_paisa),
    v_entries, v_key,
    coalesce(p_payload->'audit_meta', '{}'::jsonb) || jsonb_build_object('reason', coalesce(p_payload->>'reason', 'undo'),
                                                                       'reversed_type', v_orig.type),
    p_actor, p_at);

  insert into public.inventory_movements (shop_id, product_id, transaction_id, delta_base_units, reason, created_at)
  select p_shop_id, m.product_id, (v_tx->>'id')::uuid, -m.delta_base_units, 'reversal', p_at
  from public.inventory_movements m where m.transaction_id = v_orig.id;

  v_resp := jsonb_build_object(
    'status', 'COMMITTED', 'http', 200, 'deduplicated', false, 'duplicate_rows', 0, 'rows_for_key', 1,
    'type', 'reversal', 'reversed_transaction_id', v_orig.id, 'reversed_type', v_orig.type,
    'transaction_id', v_tx->'id', 'seq', v_tx->'seq',
    'prev_hash', v_tx->'prev_hash', 'entry_hash', v_tx->'entry_hash', 'created_at', p_at, 'rls_shop_id', p_shop_id,
    'totals', jsonb_build_object('total_paisa', -v_orig.total_paisa, 'cash_paid_paisa', -v_orig.cash_paid_paisa,
                                 'credit_paisa', -v_orig.credit_paisa),
    'journal', private.journal(v_entries), 'delta', 0, 'warnings', '[]'::jsonb,
    'customer', case when v_orig.customer_id is not null then private.customer_brief(v_orig.customer_id) end,
    'rpc_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
  perform private.idem_finish(p_shop_id, v_key, (v_tx->>'id')::uuid, v_resp);
  insert into public.audit_events (shop_id, actor_id, event, payload, created_at)
  values (p_shop_id, p_actor, 'reverse_transaction', jsonb_build_object('tx', v_tx->'id', 'reversed', v_orig.id), p_at);
  return v_resp;
exception when unique_violation then
  raise exception 'ALREADY_REVERSED';
end $$;

create or replace function public.reverse_transaction(p_shop_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return private.reverse_transaction_core(p_shop_id, p_payload, (select auth.uid()), now());
end $$;

-- ═════════════════════════════════════════════ analytics helpers

-- FIFO aging: the oldest A/R debit not yet covered by later credits.
create or replace function private.customer_aging(p_shop_id uuid)
returns table (customer_id uuid, oldest_unpaid_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with ar as (
    select le.customer_id, le.amount_paisa, le.created_at, le.id
    from public.ledger_entries le
    where le.shop_id = p_shop_id and le.account_code = '1120' and le.customer_id is not null
  ), credits as (
    select ar.customer_id, coalesce(-sum(ar.amount_paisa) filter (where ar.amount_paisa < 0), 0) as paid
    from ar group by ar.customer_id
  ), debits as (
    select ar.customer_id, ar.created_at,
           sum(ar.amount_paisa) over (partition by ar.customer_id order by ar.created_at, ar.id rows unbounded preceding) as running
    from ar where ar.amount_paisa > 0
  )
  select d.customer_id, min(d.created_at)
  from debits d join credits c on c.customer_id = d.customer_id
  where d.running > c.paid
  group by d.customer_id;
$$;

create or replace function private.sales_velocity(p_shop_id uuid)
returns table (product_id uuid, sold_7d bigint)
language sql stable security definer set search_path = '' as $$
  select m.product_id, coalesce(-sum(m.delta_base_units), 0)::bigint
  from public.inventory_movements m
  where m.shop_id = p_shop_id and m.reason = 'sale' and m.created_at >= now() - interval '7 days'
    and not exists (select 1 from public.transactions r where r.reversed_transaction_id = m.transaction_id)
  group by m.product_id;
$$;

create or replace function private.pkt_day_start() returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('day', now() at time zone 'Asia/Karachi')) at time zone 'Asia/Karachi';
$$;

create or replace function private.galla_today(p_shop_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with live as (
    select t.* from public.transactions t
    where t.shop_id = p_shop_id and t.type in ('sale', 'payment', 'purchase') and t.created_at >= private.pkt_day_start()
      and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
  ), costs as (
    select coalesce(sum(l.cost_total_paisa), 0) as cost
    from public.transaction_lines l where l.transaction_id in (select id from live where type = 'sale')
  )
  select jsonb_build_object(
    'cash_sales_paisa', coalesce(sum(cash_paid_paisa) filter (where type = 'sale'), 0),
    'sales_count', count(*) filter (where type = 'sale'),
    'cash_sales_count', count(*) filter (where type = 'sale' and credit_paisa <= 0),
    'udhaar_paisa', coalesce(sum(credit_paisa) filter (where type = 'sale' and credit_paisa > 0), 0),
    'udhaar_accounts', count(distinct customer_id) filter (where type = 'sale' and credit_paisa > 0),
    'gross_sales_paisa', coalesce(sum(total_paisa) filter (where type = 'sale'), 0),
    'wasooli_paisa', coalesce(sum(total_paisa) filter (where type = 'payment'), 0),
    'purchases_cash_paisa', coalesce(sum(cash_paid_paisa) filter (where type = 'purchase'), 0),
    'cash_in_galla_paisa', coalesce(sum(cash_paid_paisa) filter (where type = 'sale'), 0)
                         + coalesce(sum(total_paisa) filter (where type = 'payment'), 0)
                         - coalesce(sum(cash_paid_paisa) filter (where type = 'purchase'), 0),
    'est_margin_paisa', coalesce(sum(total_paisa) filter (where type = 'sale'), 0) - (select cost from costs))
  from live;
$$;

-- ═════════════════════════════════════════════ get_munshi_pulse (pure SQL, Rs. 0 LLM)

create or replace function public.get_munshi_pulse(p_shop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t0 timestamptz := clock_timestamp(); v jsonb;
begin
  perform private.assert_member(p_shop_id);
  with overdue_udhaar as (
    select c.id, c.name, c.role_tag, c.phone, c.balance_paisa, c.last_paid_at, a.oldest_unpaid_at,
           floor(extract(epoch from now() - a.oldest_unpaid_at) / 86400)::int as days_overdue
    from public.customers c join private.customer_aging(p_shop_id) a on a.customer_id = c.id
    where c.shop_id = p_shop_id and c.balance_paisa > 0 and a.oldest_unpaid_at < now() - interval '15 days'
  ), stockout_velocity as (
    select p.id, p.name, p.name_ur, p.base_unit, p.pack_size_base_units, p.stock_base_units,
           p.reorder_level_base_units, v.sold_7d,
           round(v.sold_7d::numeric / 7, 1) as daily_avg,
           greatest(round(p.stock_base_units::numeric / nullif(v.sold_7d::numeric / 7, 0), 1), 0) as days_left,
           (ceil(greatest(v.sold_7d * 2 - p.stock_base_units, p.pack_size_base_units)::numeric / p.pack_size_base_units)
             * p.pack_size_base_units)::bigint as suggested_base_units
    from public.products p join private.sales_velocity(p_shop_id) v on v.product_id = p.id
    where p.shop_id = p_shop_id and v.sold_7d > 0
      and p.stock_base_units::numeric / nullif(v.sold_7d::numeric / 7, 0) <= 2.5
  )
  select jsonb_build_object(
    'overdue', jsonb_build_object(
      'count', (select count(*) from overdue_udhaar),
      'total_paisa', (select coalesce(sum(balance_paisa), 0) from overdue_udhaar),
      'items', (select coalesce(jsonb_agg(to_jsonb(o) order by o.days_overdue desc), '[]'::jsonb) from overdue_udhaar o)),
    'stockout', jsonb_build_object(
      'count', (select count(*) from stockout_velocity),
      'items', (select coalesce(jsonb_agg(to_jsonb(s) order by s.days_left), '[]'::jsonb) from stockout_velocity s)),
    'galla', private.galla_today(p_shop_id),
    'generated_at', now()
  ) into v;
  return v || jsonb_build_object('sql_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2), 'llm_cost_rs', 0);
end $$;

-- ═════════════════════════════════════════════ chain verifier (addition: live tamper-evidence)

create or replace function public.verify_ledger_chain(p_shop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_t0 timestamptz := clock_timestamp();
  r record; v_prev text := private.genesis_hash(); v_calc text; v_n bigint := 0; v_expected_seq bigint := 1;
begin
  perform private.assert_member(p_shop_id);
  for r in select t.id, t.seq, t.type, t.total_paisa, t.created_at, t.prev_hash, t.entry_hash
           from public.transactions t where t.shop_id = p_shop_id order by t.seq loop
    v_n := v_n + 1;
    if r.seq <> v_expected_seq then
      return jsonb_build_object('ok', false, 'code', 'CHAIN_BROKEN', 'reason', 'SEQ_GAP', 'first_broken_seq', r.seq, 'checked', v_n,
        'ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
    end if;
    if r.prev_hash <> v_prev then
      return jsonb_build_object('ok', false, 'code', 'CHAIN_BROKEN', 'reason', 'PREV_HASH_MISMATCH', 'first_broken_seq', r.seq, 'checked', v_n,
        'ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
    end if;
    v_calc := private.entry_hash(r.prev_hash, r.id, r.type, r.total_paisa, r.created_at, private.ledger_digest_tx(r.id));
    if v_calc <> r.entry_hash then
      return jsonb_build_object('ok', false, 'code', 'CHAIN_BROKEN', 'reason', 'ENTRY_HASH_MISMATCH', 'first_broken_seq', r.seq,
        'transaction_id', r.id, 'checked', v_n, 'ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
    end if;
    v_prev := r.entry_hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;
  return jsonb_build_object('ok', true, 'code', 'CHAIN_OK', 'checked', v_n, 'head_hash', v_prev,
    'ledger_sum_paisa', (select coalesce(sum(amount_paisa), 0) from public.ledger_entries where shop_id = p_shop_id),
    'ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
end $$;

-- ═════════════════════════════════════════════ X-Ray for one transaction

create or replace function public.get_transaction_xray(p_shop_id uuid, p_transaction_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.transactions%rowtype; v_calc text;
begin
  perform private.assert_member(p_shop_id);
  select * into t from public.transactions where id = p_transaction_id and shop_id = p_shop_id;
  if t.id is null then raise exception 'TX_NOT_FOUND'; end if;
  v_calc := private.entry_hash(t.prev_hash, t.id, t.type, t.total_paisa, t.created_at, private.ledger_digest_tx(t.id));
  return jsonb_build_object(
    'transaction', to_jsonb(t),
    'lines', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.transaction_lines l where l.transaction_id = t.id),
    'journal', private.journal((select coalesce(jsonb_agg(jsonb_build_object('account_code', account_code,
                 'amount_paisa', amount_paisa, 'customer_id', customer_id)), '[]'::jsonb)
                 from public.ledger_entries where transaction_id = t.id)),
    'delta', (select coalesce(sum(amount_paisa), 0) from public.ledger_entries where transaction_id = t.id),
    'hash_recomputed', v_calc, 'hash_valid', v_calc = t.entry_hash,
    'rows_for_key', (select count(*) from public.transactions x where x.shop_id = p_shop_id and x.idempotency_key = t.idempotency_key),
    'reversed_by', (select r.id from public.transactions r where r.reversed_transaction_id = t.id),
    'customer', case when t.customer_id is not null then private.customer_brief(t.customer_id) end,
    'rls_shop_id', p_shop_id);
end $$;

-- ═════════════════════════════════════════════ shop state (one round-trip for the PWA)

create or replace function public.get_shop_state(p_shop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_t0 timestamptz := clock_timestamp(); v jsonb;
begin
  perform private.assert_member(p_shop_id);
  select jsonb_build_object(
    'shop', (select to_jsonb(s) from public.shops s where s.id = p_shop_id),
    'today', private.galla_today(p_shop_id),
    'feed', (
      select coalesce(jsonb_agg(f order by f.seq desc), '[]'::jsonb) from (
        select t.id, t.seq, t.type, t.customer_id, c.name as customer_name, c.role_tag as customer_role,
               t.supplier_name, t.reversed_transaction_id, t.subtotal_paisa, t.discount_paisa, t.total_paisa,
               t.cash_paid_paisa, t.credit_paisa, t.entry_hash, t.prev_hash, t.created_at, t.audit_meta,
               t.idempotency_key,
               exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id) as is_reversed,
               (select coalesce(jsonb_agg(jsonb_build_object('name', l.name_snapshot, 'qty_base_units', l.qty_base_units,
                   'base_unit', l.base_unit, 'line_total_paisa', l.line_total_paisa, 'value_first', l.value_first,
                   'product_id', l.product_id)), '[]'::jsonb)
                  from public.transaction_lines l where l.transaction_id = t.id) as lines
        from public.transactions t left join public.customers c on c.id = t.customer_id
        where t.shop_id = p_shop_id
        order by t.seq desc limit 60) f),
    'customers', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'code', c.code, 'name', c.name, 'role_tag', c.role_tag, 'phone', c.phone, 'aliases', c.aliases,
          'balance_paisa', c.balance_paisa, 'last_paid_at', c.last_paid_at, 'oldest_unpaid_at', a.oldest_unpaid_at,
          'days_overdue', case when c.balance_paisa > 0 and a.oldest_unpaid_at is not null
                               then floor(extract(epoch from now() - a.oldest_unpaid_at) / 86400)::int end)
        order by c.balance_paisa desc, c.name), '[]'::jsonb)
      from public.customers c left join private.customer_aging(p_shop_id) a on a.customer_id = c.id
      where c.shop_id = p_shop_id),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'sku_code', p.sku_code, 'name', p.name, 'name_ur', p.name_ur, 'base_unit', p.base_unit,
          'pack_size_base_units', p.pack_size_base_units, 'unit_price_paisa', p.unit_price_paisa,
          'cost_price_paisa', p.cost_price_paisa, 'stock_base_units', p.stock_base_units,
          'reorder_level_base_units', p.reorder_level_base_units, 'is_quick_added', p.is_quick_added,
          'sold_7d', coalesce(v.sold_7d, 0),
          'days_left', round(p.stock_base_units::numeric / nullif(v.sold_7d::numeric / 7, 0), 1),
          'aliases', (select coalesce(jsonb_agg(sa.alias), '[]'::jsonb) from public.sku_aliases sa where sa.product_id = p.id))
        order by p.name), '[]'::jsonb)
      from public.products p left join private.sales_velocity(p_shop_id) v on v.product_id = p.id
      where p.shop_id = p_shop_id),
    'chain_head', (select jsonb_build_object('seq', t.seq, 'entry_hash', t.entry_hash)
                   from public.transactions t where t.shop_id = p_shop_id order by t.seq desc limit 1)
  ) into v;
  return v || jsonb_build_object('sql_ms', round(extract(epoch from clock_timestamp() - v_t0)::numeric * 1000, 2));
end $$;

-- ═════════════════════════════════════════════ SMEConnect trade summary (signed by the API)

create or replace function public.get_trade_summary(p_shop_id uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := now() - make_interval(days => p_days); v jsonb; v_seq bigint; v_hash text;
begin
  perform private.assert_member(p_shop_id);
  select t.seq, t.entry_hash into v_seq, v_hash from public.transactions t where t.shop_id = p_shop_id order by t.seq desc limit 1;
  with live as (
    select t.* from public.transactions t
    where t.shop_id = p_shop_id and t.created_at >= v_from and t.type in ('sale', 'payment', 'purchase')
      and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
  )
  select jsonb_build_object(
    'shop_id', s.id, 'shop_name', s.name, 'city', s.city,
    'active_days', greatest(1, floor(extract(epoch from now() - s.active_since) / 86400)::int),
    'period_days', p_days, 'period_from', v_from, 'period_to', now(),
    'gmv_paisa', (select coalesce(sum(total_paisa), 0) from live where type = 'sale'),
    'sales_count', (select count(*) from live where type = 'sale'),
    'cash_sales_paisa', (select coalesce(sum(cash_paid_paisa), 0) from live where type = 'sale'),
    'credit_sales_paisa', (select coalesce(sum(greatest(credit_paisa, 0)), 0) from live where type = 'sale'),
    'recovered_paisa', (select coalesce(sum(total_paisa), 0) from live where type = 'payment')
                      + (select coalesce(sum(-least(credit_paisa, 0)), 0) from live where type = 'sale'),
    'purchases_paisa', (select coalesce(sum(total_paisa), 0) from live where type = 'purchase'),
    'active_trading_days', (select count(distinct (created_at at time zone 'Asia/Karachi')::date) from live where type = 'sale'),
    'receivable_paisa', (select coalesce(sum(balance_paisa), 0) from public.customers where shop_id = p_shop_id and balance_paisa > 0),
    'ledger_balanced', (select coalesce(sum(amount_paisa), 0) = 0 from public.ledger_entries where shop_id = p_shop_id),
    'tx_count_total', coalesce(v_seq, 0),
    'head_entry_hash', coalesce(v_hash, private.genesis_hash())
  ) into v
  from public.shops s where s.id = p_shop_id;
  return v;
end $$;

-- ═════════════════════════════════════════════ pg_trgm dialect fallback (server-side alias search)

create or replace function public.search_catalog(p_shop_id uuid, p_query text, p_limit int default 5) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_member(p_shop_id);
  select coalesce(jsonb_agg(x order by x.score desc), '[]'::jsonb) into v from (
    select p.id as product_id, p.name, greatest(
             extensions.similarity(lower(p.name), lower(p_query)),
             coalesce((select max(extensions.similarity(sa.alias, lower(p_query))) from public.sku_aliases sa where sa.product_id = p.id), 0)
           ) as score
    from public.products p where p.shop_id = p_shop_id
    order by 3 desc
    limit greatest(1, least(p_limit, 20))
  ) x where x.score > 0.2;
  return v;
end $$;

-- ═════════════════════════════════════════════ non-financial shop admin

create or replace function public.create_shop(p_name text, p_owner_name text default null, p_phone text default null, p_city text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  insert into public.shops (name, owner_name, phone, city) values (p_name, p_owner_name, p_phone, p_city) returning id into v_id;
  insert into public.shop_members (shop_id, user_id, role) values (v_id, v_uid, 'owner');
  insert into public.audit_events (shop_id, actor_id, event) values (v_id, v_uid, 'create_shop');
  return v_id;
end $$;

create or replace function public.add_customer(p_shop_id uuid, p_name text, p_phone text default null, p_role_tag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.assert_member(p_shop_id);
  if coalesce(trim(p_name), '') = '' then raise exception 'NAME_REQUIRED'; end if;
  insert into public.customers (shop_id, name, phone, role_tag, aliases)
  values (p_shop_id, trim(p_name), nullif(trim(p_phone), ''), nullif(trim(p_role_tag), ''), array[lower(trim(p_name))])
  returning id into v_id;
  insert into public.audit_events (shop_id, actor_id, event, payload) values (p_shop_id, (select auth.uid()), 'add_customer', jsonb_build_object('customer', v_id));
  return private.customer_brief(v_id);
end $$;

create or replace function public.update_customer(p_shop_id uuid, p_customer_id uuid, p_phone text default null, p_role_tag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  update public.customers set phone = coalesce(nullif(trim(p_phone), ''), phone), role_tag = coalesce(nullif(trim(p_role_tag), ''), role_tag)
  where id = p_customer_id and shop_id = p_shop_id;
  if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  return private.customer_brief(p_customer_id);
end $$;

create or replace function public.update_product_price(p_shop_id uuid, p_product_id uuid, p_unit_price_paisa bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_member(p_shop_id);
  if p_unit_price_paisa is null or p_unit_price_paisa < 0 then raise exception 'INVALID_AMOUNT'; end if;
  update public.products set unit_price_paisa = p_unit_price_paisa where id = p_product_id and shop_id = p_shop_id
  returning jsonb_build_object('id', id, 'name', name, 'unit_price_paisa', unit_price_paisa) into v;
  if v is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  insert into public.audit_events (shop_id, actor_id, event, payload) values (p_shop_id, (select auth.uid()), 'update_price', v);
  return v;
end $$;

create or replace function public.add_alias(p_shop_id uuid, p_product_id uuid, p_alias text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  insert into public.sku_aliases (shop_id, product_id, alias)
  select p_shop_id, p.id, lower(trim(p_alias)) from public.products p where p.id = p_product_id and p.shop_id = p_shop_id
  on conflict (shop_id, alias) do nothing;
end $$;

create or replace function public.my_shops() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'role', m.role,
           'is_demo_shop', s.is_demo_shop, 'is_stage_shop', s.is_stage_shop) order by m.created_at), '[]'::jsonb)
  from public.shop_members m join public.shops s on s.id = m.shop_id
  where m.user_id = (select auth.uid());
$$;

-- ═════════════════════════════════════════════ grants

revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.is_shop_member(uuid),
  public.commit_sale(uuid, jsonb),
  public.record_payment(uuid, jsonb),
  public.record_purchase(uuid, jsonb),
  public.reverse_transaction(uuid, jsonb),
  public.get_munshi_pulse(uuid),
  public.verify_ledger_chain(uuid),
  public.get_transaction_xray(uuid, uuid),
  public.get_shop_state(uuid),
  public.get_trade_summary(uuid, int),
  public.search_catalog(uuid, text, int),
  public.create_shop(text, text, text, text),
  public.add_customer(uuid, text, text, text),
  public.update_customer(uuid, uuid, text, text),
  public.update_product_price(uuid, uuid, bigint),
  public.add_alias(uuid, uuid, text),
  public.my_shops()
to authenticated;
