-- DukaanOS canonical seed: the protected stage shop (Bismillah Kiryana) with
-- 3 Alis + 2 Tariqs + Bilal, 125 dialect aliases and a 192-event history (14 dense days).
-- Public judges never touch this shop: each gets an isolated sandbox via create_demo_shop(user, 'sandbox').
-- scripts/setup.ts links stage@dukaanos.pk to it as owner.
select public.create_demo_shop(null, 'stage')
where not exists (select 1 from public.shops where is_stage_shop);
