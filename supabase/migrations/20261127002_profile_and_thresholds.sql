-- Shop profile update & product reorder-level tuning RPCs (owner/member-checked, search_path='')

create or replace function public.update_shop_profile(
  p_shop_id uuid,
  p_name text default null,
  p_owner_name text default null,
  p_phone text default null,
  p_city text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_member(p_shop_id);
  if p_name is not null and length(trim(p_name)) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  update public.shops
  set
    name = coalesce(nullif(trim(p_name), ''), name),
    owner_name = case when p_owner_name is null then owner_name else nullif(trim(p_owner_name), '') end,
    phone = case when p_phone is null then phone else nullif(trim(p_phone), '') end,
    city = case when p_city is null then city else nullif(trim(p_city), '') end
  where id = p_shop_id
  returning jsonb_build_object('id', id, 'name', name, 'owner_name', owner_name, 'phone', phone, 'city', city) into v;
  if v is null then raise exception 'SHOP_NOT_FOUND'; end if;
  insert into public.audit_events (shop_id, actor_id, event, payload)
  values (p_shop_id, (select auth.uid()), 'update_shop_profile', v);
  return v;
end $$;

create or replace function public.update_product_reorder_level(
  p_shop_id uuid,
  p_product_id uuid,
  p_reorder_level_base_units bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.assert_member(p_shop_id);
  if p_reorder_level_base_units is null or p_reorder_level_base_units < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  update public.products
  set reorder_level_base_units = p_reorder_level_base_units
  where id = p_product_id and shop_id = p_shop_id
  returning jsonb_build_object('id', id, 'name', name, 'reorder_level_base_units', reorder_level_base_units) into v;
  if v is null then raise exception 'PRODUCT_NOT_FOUND'; end if;
  insert into public.audit_events (shop_id, actor_id, event, payload)
  values (p_shop_id, (select auth.uid()), 'update_reorder_level', v);
  return v;
end $$;

revoke all on function public.update_shop_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_shop_profile(uuid, text, text, text, text) to authenticated, service_role;

revoke all on function public.update_product_reorder_level(uuid, uuid, bigint) from public, anon;
grant execute on function public.update_product_reorder_level(uuid, uuid, bigint) to authenticated, service_role;
