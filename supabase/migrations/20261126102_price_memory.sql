-- DukaanOS · 20261126102 · Supplier Price Memory (7F)
-- Every scanned parchi already lands as record_purchase lines. This reads that history to catch
-- wholesale price rises ("Ghee +8% vs pichli parchi") and the margin they silently eat, and suggests a
-- retail price that keeps the previous margin. Pure SQL, integer paisa, Rs. 0 LLM. Read-only.

create or replace function public.get_price_memory(p_shop_id uuid, p_min_change_bp int default 1) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return coalesce((
    with buys as (
      select tl.product_id, t.created_at, t.supplier_name,
             -- per-pack cost in paisa from the parchi line (integer, half-up)
             round(tl.line_total_paisa::numeric * tl.pack_size_base_units / tl.qty_base_units)::bigint as pack_cost,
             row_number() over (partition by tl.product_id order by t.seq desc) as rn
      from public.transaction_lines tl
      join public.transactions t on t.id = tl.transaction_id
      where t.shop_id = p_shop_id and t.type = 'purchase' and tl.product_id is not null and tl.qty_base_units > 0
        and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
    ), pairs as (
      select a.product_id, a.pack_cost as last_cost, b.pack_cost as prev_cost, a.created_at as last_at,
             b.created_at as prev_at, a.supplier_name
      from buys a join buys b on b.product_id = a.product_id and b.rn = 2
      where a.rn = 1 and b.pack_cost > 0
    ), calc as (
      select p.id, p.name, p.name_ur, p.base_unit, p.pack_size_base_units, p.unit_price_paisa as retail,
             x.last_cost, x.prev_cost, x.last_at, x.prev_at, x.supplier_name,
             round((x.last_cost - x.prev_cost)::numeric * 10000 / x.prev_cost)::int as change_bp,
             case when p.unit_price_paisa > 0 then round((p.unit_price_paisa - x.prev_cost)::numeric * 10000 / p.unit_price_paisa)::int end as margin_before_bp,
             case when p.unit_price_paisa > 0 then round((p.unit_price_paisa - x.last_cost)::numeric * 10000 / p.unit_price_paisa)::int end as margin_now_bp,
             -- keep the old margin: retail * last_cost / prev_cost, rounded UP to the next Rs. 5
             (ceil(p.unit_price_paisa::numeric * x.last_cost / x.prev_cost / 500) * 500)::bigint as suggested_price_paisa
      from pairs x join public.products p on p.id = x.product_id
    )
    select jsonb_agg(jsonb_build_object(
      'product_id', c.id, 'name', c.name, 'name_ur', c.name_ur, 'base_unit', c.base_unit,
      'pack_size_base_units', c.pack_size_base_units, 'retail_price_paisa', c.retail,
      'last_cost_paisa', c.last_cost, 'prev_cost_paisa', c.prev_cost, 'change_bp', c.change_bp,
      'margin_before_bp', c.margin_before_bp, 'margin_now_bp', c.margin_now_bp,
      'suggested_price_paisa', case when c.change_bp > 0 and c.suggested_price_paisa > c.retail then c.suggested_price_paisa end,
      'supplier_name', c.supplier_name, 'last_at', c.last_at, 'prev_at', c.prev_at
    ) order by c.change_bp desc)
    from calc c
    where abs(c.change_bp) >= greatest(p_min_change_bp, 1)
  ), '[]'::jsonb);
end $$;

revoke all on function public.get_price_memory(uuid, int) from public, anon;
grant execute on function public.get_price_memory(uuid, int) to authenticated, service_role;
