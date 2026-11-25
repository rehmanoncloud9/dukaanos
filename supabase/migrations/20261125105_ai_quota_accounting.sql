-- Extend the existing aggregate; do not create a second quota/accounting table.
-- est_cost_micros stores an estimated PKR cost (one PKR = 1,000,000 micros).
alter table public.ai_usage
  add column if not exists cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  add column if not exists reserved_input_tokens bigint not null default 0 check (reserved_input_tokens >= 0),
  add column if not exists reserved_output_tokens bigint not null default 0 check (reserved_output_tokens >= 0),
  add column if not exists reserved_cost_micros bigint not null default 0 check (reserved_cost_micros >= 0),
  add column if not exists model_usage jsonb not null default '{}'::jsonb;

-- Atomically reserve count, tokens, and a model-specific upper-bound estimate.
create or replace function public.consume_ai_quota(
  p_shop_id uuid,
  p_kind text,
  p_tokens_in bigint,
  p_tokens_out bigint,
  p_shop_cap int,
  p_global_cap_micros bigint,
  p_reservation_cost_micros bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_cap int;
  v_calls int;
  v_global_cost numeric;
  v_reservation_cost bigint := greatest(coalesce(p_reservation_cost_micros, 0), 0);
  v_retry int;
begin
  if p_kind not in ('voice', 'parchi', 'qa', 'tts') then
    raise exception 'BAD_REQUEST: invalid ai kind %', p_kind;
  end if;
  if greatest(coalesce(p_tokens_in, 0), 0) > 100000000
     or greatest(coalesce(p_tokens_out, 0), 0) > 100000000
     or v_reservation_cost > 1000000000000 then
    raise exception 'BAD_REQUEST: AI reservation is out of range';
  end if;

  v_cap := coalesce(p_shop_cap, case p_kind
    when 'voice' then 400 when 'parchi' then 30 when 'qa' then 60 when 'tts' then 60
  end);
  v_retry := greatest(ceil(extract(epoch from (((v_day + 1)::timestamp at time zone 'UTC') - now())))::int, 1);

  -- A shared lock serializes the global cap; a second lock serializes each shop cap.
  perform pg_advisory_xact_lock(hashtextextended('ai_quota_global:' || v_day::text, 42));
  perform pg_advisory_xact_lock(hashtextextended('ai_quota:' || p_shop_id::text || ':' || p_kind, 42));

  select coalesce(sum(est_cost_micros::numeric + reserved_cost_micros::numeric), 0)
    into v_global_cost
  from public.ai_usage where day = v_day;

  if p_global_cap_micros is not null and v_global_cost + v_reservation_cost > p_global_cap_micros then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'retry_after', v_retry, 'reason', 'GLOBAL_CAP');
  end if;

  select calls into v_calls from public.ai_usage
  where shop_id = p_shop_id and day = v_day and kind = p_kind;
  if coalesce(v_calls, 0) >= v_cap then
    return jsonb_build_object('allowed', false, 'remaining', 0, 'retry_after', v_retry, 'reason', 'SHOP_CAP');
  end if;

  insert into public.ai_usage (
    shop_id, day, kind, calls, reserved_input_tokens, reserved_output_tokens, reserved_cost_micros
  ) values (
    p_shop_id, v_day, p_kind, 1, greatest(coalesce(p_tokens_in, 0), 0),
    greatest(coalesce(p_tokens_out, 0), 0), v_reservation_cost
  )
  on conflict (shop_id, day, kind) do update set
    calls = public.ai_usage.calls + 1,
    reserved_input_tokens = public.ai_usage.reserved_input_tokens + excluded.reserved_input_tokens,
    reserved_output_tokens = public.ai_usage.reserved_output_tokens + excluded.reserved_output_tokens,
    reserved_cost_micros = public.ai_usage.reserved_cost_micros + excluded.reserved_cost_micros
  returning calls into v_calls;

  return jsonb_build_object('allowed', true, 'remaining', greatest(v_cap - v_calls, 0), 'retry_after', 0);
end $$;

-- Backward-compatible signature for existing service-role callers.
create or replace function public.consume_ai_quota(
  p_shop_id uuid,
  p_kind text,
  p_tokens_in bigint default 0,
  p_tokens_out bigint default 0,
  p_shop_cap int default null,
  p_global_cap_micros bigint default 5000000000
) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.consume_ai_quota(
    p_shop_id, p_kind, p_tokens_in, p_tokens_out, p_shop_cap, p_global_cap_micros,
    greatest(coalesce(p_tokens_in, 0), 0) * 50 + greatest(coalesce(p_tokens_out, 0), 0) * 200
  );
end $$;

-- Settle exactly one reservation with SDK token metadata and its estimated PKR cost.
create or replace function public.record_ai_usage(
  p_shop_id uuid,
  p_kind text,
  p_tokens_in bigint,
  p_tokens_out bigint,
  p_cached_tokens bigint,
  p_model text,
  p_reserved_tokens_in bigint,
  p_reserved_tokens_out bigint,
  p_reserved_cost_micros bigint,
  p_est_cost_micros bigint,
  p_cost_basis text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_input bigint := greatest(coalesce(p_tokens_in, 0), 0);
  v_output bigint := greatest(coalesce(p_tokens_out, 0), 0);
  v_cached bigint := least(greatest(coalesce(p_cached_tokens, 0), 0), v_input);
  v_reserved_input bigint := greatest(coalesce(p_reserved_tokens_in, 0), 0);
  v_reserved_output bigint := greatest(coalesce(p_reserved_tokens_out, 0), 0);
  v_reserved_cost bigint := greatest(coalesce(p_reserved_cost_micros, 0), 0);
  v_actual_cost bigint := greatest(coalesce(p_est_cost_micros, 0), 0);
  v_model text := left(coalesce(nullif(p_model, ''), 'unknown'), 120);
  v_basis text := left(coalesce(nullif(p_cost_basis, ''), 'unknown'), 40);
begin
  if p_kind not in ('voice', 'parchi', 'qa', 'tts') then
    raise exception 'BAD_REQUEST: invalid ai kind %', p_kind;
  end if;
  if v_input > 100000000 or v_output > 100000000
     or v_reserved_input > 100000000 or v_reserved_output > 100000000
     or v_reserved_cost > 1000000000000 or v_actual_cost > 1000000000000 then
    raise exception 'BAD_REQUEST: AI usage is out of range';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai_quota_global:' || v_day::text, 42));

  insert into public.ai_usage (
    shop_id, day, kind, calls, input_tokens, output_tokens, cached_input_tokens, est_cost_micros, model_usage
  ) values (
    p_shop_id, v_day, p_kind, 0, v_input, v_output, v_cached, v_actual_cost,
    jsonb_build_object(v_model, jsonb_build_object(
      'calls', 1, 'input_tokens', v_input, 'output_tokens', v_output,
      'cached_input_tokens', v_cached, 'est_cost_micros', v_actual_cost, 'cost_basis', v_basis
    ))
  )
  on conflict (shop_id, day, kind) do update set
    input_tokens = public.ai_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_usage.output_tokens + excluded.output_tokens,
    cached_input_tokens = public.ai_usage.cached_input_tokens + excluded.cached_input_tokens,
    -- Add the settled actual cost; separately, credit back the reservation that was pre-counted.
    est_cost_micros = public.ai_usage.est_cost_micros + excluded.est_cost_micros,
    reserved_input_tokens = greatest(public.ai_usage.reserved_input_tokens - v_reserved_input, 0),
    reserved_output_tokens = greatest(public.ai_usage.reserved_output_tokens - v_reserved_output, 0),
    reserved_cost_micros = greatest(public.ai_usage.reserved_cost_micros - v_reserved_cost, 0),
    model_usage = jsonb_set(
      public.ai_usage.model_usage,
      array[v_model],
      jsonb_build_object(
        'calls', coalesce((public.ai_usage.model_usage->v_model->>'calls')::bigint, 0) + 1,
        'input_tokens', coalesce((public.ai_usage.model_usage->v_model->>'input_tokens')::bigint, 0) + v_input,
        'output_tokens', coalesce((public.ai_usage.model_usage->v_model->>'output_tokens')::bigint, 0) + v_output,
        'cached_input_tokens', coalesce((public.ai_usage.model_usage->v_model->>'cached_input_tokens')::bigint, 0) + v_cached,
        'est_cost_micros', coalesce((public.ai_usage.model_usage->v_model->>'est_cost_micros')::bigint, 0) + v_actual_cost,
        'cost_basis', v_basis
      ), true
    );
end $$;

-- Preserve the original legacy RPC for other service-role callers/tests.
create or replace function public.record_ai_usage(
  p_shop_id uuid,
  p_kind text,
  p_tokens_in bigint,
  p_tokens_out bigint
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.record_ai_usage(
    p_shop_id, p_kind, p_tokens_in, p_tokens_out, 0, 'unknown', 0, 0, 0,
    greatest(coalesce(p_tokens_in, 0), 0) * 50 + greatest(coalesce(p_tokens_out, 0), 0) * 200,
    'legacy-estimate'
  );
end $$;

revoke all on function public.consume_ai_quota(uuid, text, bigint, bigint, int, bigint, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, bigint, bigint, int, bigint, bigint) to service_role;
revoke all on function public.consume_ai_quota(uuid, text, bigint, bigint, int, bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid, text, bigint, bigint, int, bigint) to service_role;
revoke all on function public.record_ai_usage(uuid, text, bigint, bigint, bigint, text, bigint, bigint, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, bigint, bigint, bigint, text, bigint, bigint, bigint, bigint, text) to service_role;
revoke all on function public.record_ai_usage(uuid, text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, bigint, bigint) to service_role;
