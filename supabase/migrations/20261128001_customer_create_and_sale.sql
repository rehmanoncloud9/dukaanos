-- Create a newly spoken customer in the same transaction as the sale.
-- The caller supplies a stable UUID so later offline commits can reference it.
create or replace function public.commit_sale_with_customer(p_shop_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := p_payload->>'idempotency_key';
  v_name text := nullif(trim(p_payload->>'new_customer_name'), '');
  v_customer uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_new_customer_id uuid := nullif(p_payload->>'new_customer_id', '')::uuid;
  v_payload jsonb := p_payload;
  v_cached jsonb;
  v_rows bigint;
begin
  perform private.assert_member(p_shop_id);
  if v_key is null or length(v_key) < 8 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;

  -- Serialize the replay check, customer insert, and commit under the same shop lock.
  perform private.lock_shop(p_shop_id);
  select response into v_cached
  from public.idempotency_keys
  where shop_id = p_shop_id and idempotency_key = v_key;
  if found then
    if v_cached is not null then
      select count(*) into v_rows
      from public.transactions
      where shop_id = p_shop_id and idempotency_key = v_key;
      return v_cached || jsonb_build_object(
        'deduplicated', true,
        'status', 'REPLAY_DEDUPLICATED',
        'http', 200,
        'rows_for_key', v_rows,
        'duplicate_rows', greatest(v_rows - 1, 0)
      );
    end if;
    -- A key already exists without a finished response; let the core return its replay result.
    return private.commit_sale_core(p_shop_id, p_payload, (select auth.uid()), now());
  end if;

  if v_customer is null and v_name is not null then
    if length(v_name) > 120 then raise exception 'CUSTOMER_NAME_TOO_LONG'; end if;
    v_customer := coalesce(v_new_customer_id, gen_random_uuid());
    insert into public.customers (id, shop_id, name)
    values (v_customer, p_shop_id, v_name);
    v_payload := jsonb_set(v_payload, '{customer_id}', to_jsonb(v_customer), true);
  end if;

  return private.commit_sale_core(p_shop_id, v_payload, (select auth.uid()), now());
end;
$$;

revoke all on function public.commit_sale_with_customer(uuid, jsonb) from public, anon;
grant execute on function public.commit_sale_with_customer(uuid, jsonb) to authenticated, service_role;

-- A product added without an opening count stays visibly uncounted until stock
-- arrives or the owner records a physical count/adjustment.
create or replace function private.clear_quick_added_after_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reason in ('purchase', 'opening', 'adjustment') then
    update public.products
    set is_quick_added = false
    where id = new.product_id and shop_id = new.shop_id and is_quick_added;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_count_marks_product_trg on public.inventory_movements;
create trigger inventory_count_marks_product_trg
after insert on public.inventory_movements
for each row execute function private.clear_quick_added_after_count();

create or replace function public.add_product_with_count_flag(p_shop_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_id uuid;
  v_counted boolean := p_payload ? 'opening_stock_base_units'
    and p_payload->>'opening_stock_base_units' is not null;
begin
  perform private.assert_member(p_shop_id);
  v_result := public.add_product(p_shop_id, p_payload);
  v_id := (v_result->>'id')::uuid;
  if not v_counted then
    update public.products
    set is_quick_added = true
    where id = v_id and shop_id = p_shop_id;
  end if;
  return v_result || jsonb_build_object('is_quick_added', not v_counted);
end;
$$;

revoke all on function public.add_product_with_count_flag(uuid, jsonb) from public, anon;
grant execute on function public.add_product_with_count_flag(uuid, jsonb) to authenticated, service_role;

-- Keep a trustworthy last-sale timestamp per SKU instead of inferring it from a
-- short feed window (which mislabels fast-store items as dead stock).
alter table public.products add column if not exists last_sold_at timestamptz;
create index if not exists transaction_lines_shop_product_tx_idx
  on public.transaction_lines (shop_id, product_id, transaction_id)
  where product_id is not null;

update public.products p
set last_sold_at = latest.last_sold_at
from (
  select l.shop_id, l.product_id, max(t.created_at) as last_sold_at
  from public.transaction_lines l
  join public.transactions t on t.id = l.transaction_id and t.shop_id = l.shop_id
  where t.type = 'sale'
    and not exists (
      select 1 from public.transactions r where r.reversed_transaction_id = t.id
    )
  group by l.shop_id, l.product_id
) latest
where p.shop_id = latest.shop_id
  and p.id = latest.product_id
  and p.last_sold_at is distinct from latest.last_sold_at;

create or replace function private.track_product_last_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reason = 'sale' then
    update public.products p
    set last_sold_at = greatest(coalesce(p.last_sold_at, new.created_at), new.created_at)
    where p.id = new.product_id and p.shop_id = new.shop_id;
  elsif new.reason = 'reversal' then
    update public.products p
    set last_sold_at = (
      select max(t.created_at)
      from public.transaction_lines l
      join public.transactions t on t.id = l.transaction_id and t.shop_id = l.shop_id
      where l.shop_id = p.shop_id
        and l.product_id = p.id
        and t.type = 'sale'
        and not exists (
          select 1 from public.transactions r where r.reversed_transaction_id = t.id
        )
    )
    where p.id = new.product_id and p.shop_id = new.shop_id;
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_track_product_last_sale_trg on public.inventory_movements;
create trigger inventory_track_product_last_sale_trg
after insert on public.inventory_movements
for each row execute function private.track_product_last_sale();

create index if not exists products_shop_name_prefix_idx
  on public.products (shop_id, lower(name) text_pattern_ops);
create index if not exists products_shop_name_ur_prefix_idx
  on public.products (shop_id, lower(name_ur) text_pattern_ops)
  where name_ur is not null;
create index if not exists sku_aliases_shop_alias_lower_idx
  on public.sku_aliases (shop_id, lower(alias));
create index if not exists customers_shop_name_prefix_idx
  on public.customers (shop_id, lower(name) text_pattern_ops);

-- Extend the existing state payload with age metadata without changing the
-- accounting RPC that owns the financial aggregates.
create or replace function public.get_shop_state_with_stock_age(p_shop_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_products jsonb;
begin
  perform private.assert_member(p_shop_id);
  v_state := public.get_shop_state(p_shop_id);
  select coalesce(jsonb_agg(item.value || jsonb_build_object(
    'created_at', p.created_at,
    'last_sold_at', p.last_sold_at
  ) order by p.name), '[]'::jsonb)
  into v_products
  from jsonb_array_elements(coalesce(v_state->'products', '[]'::jsonb)) as item(value)
  join public.products p
    on p.id = (item.value->>'id')::uuid
   and p.shop_id = p_shop_id;
  return jsonb_set(v_state, '{products}', v_products, true);
end;
$$;

revoke all on function public.get_shop_state_with_stock_age(uuid) from public, anon;
grant execute on function public.get_shop_state_with_stock_age(uuid) to authenticated, service_role;
