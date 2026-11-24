-- DukaanOS · 20261125102 · Data rights (delete/export/purge), paginated feed/ledger, credit limits

-- ───────────────────────────────────────────── 1. Account deletion audit & RPC
create table if not exists public.account_deletion_audit (
  id                        uuid primary key default gen_random_uuid(),
  user_id_hash              text not null,
  deleted_shops_count       int not null default 0,
  removed_memberships_count int not null default 0,
  created_at                timestamptz not null default now()
);

alter table public.account_deletion_audit enable row level security;
revoke all on table public.account_deletion_audit from public, anon, authenticated;

create or replace function public.delete_user_account_data(
  p_user_id uuid,
  p_user_id_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sole_shops uuid[];
  v_deleted_shops int := 0;
  v_removed_memberships int := 0;
begin
  -- Shops where this user is the sole owner (or sole sandbox judge)
  select coalesce(array_agg(m.shop_id), '{}') into v_sole_shops
  from public.shop_members m
  where m.user_id = p_user_id
    and m.role in ('owner', 'judge')
    and not exists (
      select 1 from public.shop_members other
      where other.shop_id = m.shop_id
        and other.user_id <> p_user_id
        and other.role = 'owner'
    );

  -- Remove memberships in shared shops first
  delete from public.shop_members
  where user_id = p_user_id
    and not (shop_id = any(v_sole_shops));
  get diagnostics v_removed_memberships = row_count;

  -- Delete sole-owner shops in maintenance mode (bypasses immutable ledger triggers cleanly)
  if coalesce(array_length(v_sole_shops, 1), 0) > 0 then
    perform set_config('dukaan.maintenance', 'on', true);
    delete from public.shops where id = any(v_sole_shops);
    get diagnostics v_deleted_shops = row_count;
    perform set_config('dukaan.maintenance', 'off', true);
  end if;

  insert into public.account_deletion_audit (user_id_hash, deleted_shops_count, removed_memberships_count)
  values (p_user_id_hash, v_deleted_shops, v_removed_memberships);

  return jsonb_build_object(
    'deleted_shops', v_deleted_shops,
    'removed_memberships', v_removed_memberships
  );
end $$;

revoke all on function public.delete_user_account_data(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_user_account_data(uuid, text) to service_role;

-- ───────────────────────────────────────────── 2. Shop data export RPC (for GET /api/account/export)
create or replace function public.export_shop_data(p_shop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return jsonb_build_object(
    'shop', (select to_jsonb(s) from public.shops s where s.id = p_shop_id),
    'customers', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb)
                  from public.customers c where c.shop_id = p_shop_id),
    'products', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at), '[]'::jsonb)
                 from public.products p where p.shop_id = p_shop_id),
    'transactions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.seq), '[]'::jsonb)
                     from public.transactions t where t.shop_id = p_shop_id),
    'transaction_lines', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
                          from public.transaction_lines l where l.shop_id = p_shop_id),
    'ledger_entries', (select coalesce(jsonb_agg(to_jsonb(le) order by le.id), '[]'::jsonb)
                       from public.ledger_entries le where le.shop_id = p_shop_id),
    'chain_head', (select jsonb_build_object('seq', t.seq, 'entry_hash', t.entry_hash)
                   from public.transactions t where t.shop_id = p_shop_id order by t.seq desc limit 1)
  );
end $$;

revoke all on function public.export_shop_data(uuid) from public, anon;
grant execute on function public.export_shop_data(uuid) to authenticated, service_role;

-- ───────────────────────────────────────────── 3. Sandbox retention purge (72h, never touches stage shop)
create or replace function public.purge_stale_sandboxes(p_older_than interval default '72 hours') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_shop_ids uuid[];
  v_user_ids uuid[];
  v_deleted int := 0;
begin
  select coalesce(array_agg(s.id), '{}') into v_shop_ids
  from public.shops s
  where s.is_demo_shop = true
    and s.is_stage_shop = false
    and s.created_at < now() - p_older_than;

  if coalesce(array_length(v_shop_ids, 1), 0) = 0 then
    return jsonb_build_object('deleted_shops', 0, 'user_ids', '[]'::jsonb);
  end if;

  select coalesce(array_agg(distinct m.user_id), '{}') into v_user_ids
  from public.shop_members m
  where m.shop_id = any(v_shop_ids)
    and m.role = 'judge'
    and not exists (
      select 1 from public.shop_members other
      where other.user_id = m.user_id and not (other.shop_id = any(v_shop_ids))
    );

  perform set_config('dukaan.maintenance', 'on', true);
  delete from public.shops where id = any(v_shop_ids);
  get diagnostics v_deleted = row_count;
  perform set_config('dukaan.maintenance', 'off', true);

  return jsonb_build_object(
    'deleted_shops', v_deleted,
    'user_ids', to_jsonb(v_user_ids)
  );
end $$;

revoke all on function public.purge_stale_sandboxes(interval) from public, anon, authenticated;
grant execute on function public.purge_stale_sandboxes(interval) to service_role;

-- ───────────────────────────────────────────── 4. Paginated customer ledger & shop feed
create or replace function public.get_customer_ledger(
  p_shop_id uuid,
  p_customer_id uuid,
  p_before_seq bigint default null,
  p_limit int default 50
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_cust jsonb;
  v_items jsonb;
  v_next bigint;
begin
  perform private.assert_member(p_shop_id);

  select to_jsonb(c) into v_cust
  from public.customers c
  where c.shop_id = p_shop_id and c.id = p_customer_id;

  if v_cust is null then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  with rows as (
    select t.id, t.seq, t.type, t.customer_id, t.reversed_transaction_id,
           t.subtotal_paisa, t.discount_paisa, t.total_paisa, t.cash_paid_paisa, t.credit_paisa,
           t.entry_hash, t.prev_hash, t.created_at, t.idempotency_key,
           exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id) as is_reversed,
           (select coalesce(jsonb_agg(jsonb_build_object(
              'name', l.name_snapshot, 'qty_base_units', l.qty_base_units,
              'base_unit', l.base_unit, 'line_total_paisa', l.line_total_paisa,
              'value_first', l.value_first, 'product_id', l.product_id)), '[]'::jsonb)
            from public.transaction_lines l where l.transaction_id = t.id) as lines
    from public.transactions t
    where t.shop_id = p_shop_id
      and t.customer_id = p_customer_id
      and (p_before_seq is null or t.seq < p_before_seq)
    order by t.seq desc
    limit v_lim
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.seq desc), '[]'::jsonb), min(r.seq)
  into v_items, v_next
  from rows r;

  return jsonb_build_object(
    'customer', v_cust,
    'items', v_items,
    'next_before_seq', case when jsonb_array_length(v_items) = v_lim then v_next else null end
  );
end $$;

create or replace function public.get_shop_feed(
  p_shop_id uuid,
  p_before_seq bigint default null,
  p_limit int default 40
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 40), 1), 200);
  v_items jsonb;
  v_next bigint;
begin
  perform private.assert_member(p_shop_id);

  with rows as (
    select t.id, t.seq, t.type, t.customer_id, c.name as customer_name, c.role_tag as customer_role,
           t.supplier_name, t.reversed_transaction_id, t.subtotal_paisa, t.discount_paisa, t.total_paisa,
           t.cash_paid_paisa, t.credit_paisa, t.entry_hash, t.prev_hash, t.created_at, t.audit_meta,
           t.idempotency_key,
           exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id) as is_reversed,
           (select coalesce(jsonb_agg(jsonb_build_object(
              'name', l.name_snapshot, 'qty_base_units', l.qty_base_units,
              'base_unit', l.base_unit, 'line_total_paisa', l.line_total_paisa,
              'value_first', l.value_first, 'product_id', l.product_id)), '[]'::jsonb)
            from public.transaction_lines l where l.transaction_id = t.id) as lines
    from public.transactions t
    left join public.customers c on c.id = t.customer_id
    where t.shop_id = p_shop_id
      and (p_before_seq is null or t.seq < p_before_seq)
    order by t.seq desc
    limit v_lim
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.seq desc), '[]'::jsonb), min(r.seq)
  into v_items, v_next
  from rows r;

  return jsonb_build_object(
    'items', v_items,
    'next_before_seq', case when jsonb_array_length(v_items) = v_lim then v_next else null end
  );
end $$;

revoke all on function public.get_customer_ledger(uuid, uuid, bigint, int) from public, anon;
grant execute on function public.get_customer_ledger(uuid, uuid, bigint, int) to authenticated, service_role;

revoke all on function public.get_shop_feed(uuid, bigint, int) from public, anon;
grant execute on function public.get_shop_feed(uuid, bigint, int) to authenticated, service_role;

-- ───────────────────────────────────────────── 5. Customer soft credit limit (CFO risk control)
alter table public.customers
  add column if not exists credit_limit_paisa bigint check (credit_limit_paisa is null or credit_limit_paisa >= 0);

create or replace function public.update_customer_credit_limit(
  p_shop_id uuid,
  p_customer_id uuid,
  p_credit_limit_paisa bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row jsonb;
begin
  perform private.assert_member(p_shop_id);
  if p_credit_limit_paisa is not null and p_credit_limit_paisa < 0 then
    raise exception 'INVALID_AMOUNT: credit_limit_paisa must be >= 0';
  end if;
  update public.customers
  set credit_limit_paisa = p_credit_limit_paisa
  where id = p_customer_id and shop_id = p_shop_id
  returning to_jsonb(customers.*) into v_row;
  if v_row is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  return v_row;
end $$;

revoke all on function public.update_customer_credit_limit(uuid, uuid, bigint) from public, anon;
grant execute on function public.update_customer_credit_limit(uuid, uuid, bigint) to authenticated, service_role;
