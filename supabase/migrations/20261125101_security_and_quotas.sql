-- DukaanOS · 20261125101 · Persistent rate limiting & AI cost quotas (ASVS L2 + CFO controls)

-- ───────────────────────────────────────────── 1. Persistent rate limits (service-role only)
create table if not exists public.rate_limits (
  bucket       text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now()
);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_max int,
  p_window interval
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_count int;
  v_start timestamptz;
  v_retry int;
begin
  if p_max <= 0 then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'retry_after', 60);
  end if;

  insert into public.rate_limits (bucket, count, window_start)
  values (p_bucket, 1, v_now)
  on conflict (bucket) do update
    set count = case
          when public.rate_limits.window_start + p_window <= v_now then 1
          when public.rate_limits.count < p_max then public.rate_limits.count + 1
          else public.rate_limits.count
        end,
        window_start = case
          when public.rate_limits.window_start + p_window <= v_now then v_now
          else public.rate_limits.window_start
        end
  returning count, window_start into v_count, v_start;

  -- Note: if count was already >= p_max before this call, it stayed at p_max.
  -- Distinguish "just hit p_max" vs "was already at p_max" by checking if window was not reset and count = p_max:
  -- Wait: if count was p_max - 1, it incremented to p_max (allowed). If it was p_max, it stayed p_max (blocked).
  -- To be 100% exact without ambiguity, allow up to p_max by storing count up to p_max + 1:
  return jsonb_build_object(
    'allowed', v_count <= p_max,
    'remaining', greatest(p_max - v_count, 0),
    'retry_after', greatest(ceil(extract(epoch from (v_start + p_window - v_now)))::int, 1)
  );
end $$;

-- Fix exact boundary: allow count = p_max, block on p_max + 1
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_max int,
  p_window interval
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_count int;
  v_start timestamptz;
begin
  if p_max <= 0 then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'retry_after', 60);
  end if;

  insert into public.rate_limits (bucket, count, window_start)
  values (p_bucket, 1, v_now)
  on conflict (bucket) do update
    set count = case
          when public.rate_limits.window_start + p_window <= v_now then 1
          when public.rate_limits.count <= p_max then public.rate_limits.count + 1
          else public.rate_limits.count
        end,
        window_start = case
          when public.rate_limits.window_start + p_window <= v_now then v_now
          else public.rate_limits.window_start
        end
  returning count, window_start into v_count, v_start;

  return jsonb_build_object(
    'allowed', v_count <= p_max,
    'remaining', greatest(p_max - v_count, 0),
    'retry_after', greatest(ceil(extract(epoch from (v_start + p_window - v_now)))::int, 1)
  );
end $$;

revoke all on function public.consume_rate_limit(text, int, interval) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, int, interval) to service_role;

-- ───────────────────────────────────────────── 2. AI usage & daily cost quotas
create table if not exists public.ai_usage (
  shop_id         uuid not null references public.shops(id) on delete cascade,
  day             date not null default (now() at time zone 'UTC')::date,
  kind            text not null check (kind in ('voice', 'parchi', 'qa', 'tts')),
  calls           int not null default 0,
  input_tokens    bigint not null default 0,
  output_tokens   bigint not null default 0,
  est_cost_micros bigint not null default 0,
  primary key (shop_id, day, kind)
);
create index if not exists ai_usage_day_idx on public.ai_usage (day);

alter table public.ai_usage enable row level security;
grant select on public.ai_usage to authenticated;
create policy ai_usage_select_member on public.ai_usage
  for select to authenticated
  using (public.is_shop_member(shop_id));

create or replace function public.consume_ai_quota(
  p_shop_id uuid,
  p_kind text,
  p_tokens_in bigint default 0,
  p_tokens_out bigint default 0,
  p_shop_cap int default null,
  p_global_cap_micros bigint default 5000000000
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_cap int;
  v_calls int;
  v_global_cost bigint;
  v_cost_micros bigint;
  v_retry int;
begin
  if p_kind not in ('voice', 'parchi', 'qa', 'tts') then
    raise exception 'BAD_REQUEST: invalid ai kind %', p_kind;
  end if;

  v_cap := coalesce(p_shop_cap, case p_kind
    when 'voice' then 400
    when 'parchi' then 30
    when 'qa' then 60
    when 'tts' then 60
  end);

  v_retry := greatest(ceil(extract(epoch from (((v_day + 1)::timestamp at time zone 'UTC') - now())))::int, 1);

  -- Global daily PKR cap check (1 PKR = 1,000,000 micros)
  select coalesce(sum(est_cost_micros), 0) into v_global_cost
  from public.ai_usage
  where day = v_day;

  if p_global_cap_micros is not null and v_global_cost >= p_global_cap_micros then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'retry_after', v_retry, 'reason', 'GLOBAL_CAP');
  end if;

  -- Estimate cost in PKR micros (~Rs 0.05 / 1K input tokens, ~Rs 0.20 / 1K output tokens)
  v_cost_micros := greatest(coalesce(p_tokens_in, 0), 0) * 50 + greatest(coalesce(p_tokens_out, 0), 0) * 200;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_shop_id::text || ':' || p_kind, 42));

  select calls into v_calls
  from public.ai_usage
  where shop_id = p_shop_id and day = v_day and kind = p_kind;

  if coalesce(v_calls, 0) >= v_cap then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'retry_after', v_retry, 'reason', 'SHOP_CAP');
  end if;

  insert into public.ai_usage (shop_id, day, kind, calls, input_tokens, output_tokens, est_cost_micros)
  values (p_shop_id, v_day, p_kind, 1, greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0), v_cost_micros)
  on conflict (shop_id, day, kind) do update
    set calls = public.ai_usage.calls + 1,
        input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
        output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
        est_cost_micros = public.ai_usage.est_cost_micros + excluded.est_cost_micros
  returning calls into v_calls;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(v_cap - v_calls, 0),
    'retry_after', 0
  );
end $$;

create or replace function public.record_ai_usage(
  p_shop_id uuid,
  p_kind text,
  p_tokens_in bigint,
  p_tokens_out bigint
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_cost_micros bigint := greatest(coalesce(p_tokens_in, 0), 0) * 50 + greatest(coalesce(p_tokens_out, 0), 0) * 200;
begin
  insert into public.ai_usage (shop_id, day, kind, calls, input_tokens, output_tokens, est_cost_micros)
  values (p_shop_id, v_day, p_kind, 0, greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0), v_cost_micros)
  on conflict (shop_id, day, kind) do update
    set input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
        output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
        est_cost_micros = public.ai_usage.est_cost_micros + excluded.est_cost_micros;
end $$;

revoke all on function public.consume_ai_quota(uuid, text, bigint, bigint, int, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, bigint, bigint, int, bigint) to service_role;

revoke all on function public.record_ai_usage(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, bigint, bigint) to service_role;
