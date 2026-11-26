-- DukaanOS · 20261126101 · Mutual Khata (Bharosa Layer)
-- Two-party-verified udhaar: the CUSTOMER confirms or disputes each credit entry, promises a
-- repayment date (wada) or claims a payment, through an Ed25519-signed link. Every attestation is
-- an append-only, per-shop SHA-256 chain that also binds the attested transaction's entry_hash, so
-- neither the shopkeeper nor a DBA can silently invent "customer confirmed" history.
--
-- Trust boundary:
--   * source = 'customer' rows can ONLY be written by service_role (the /api/khata/attest route,
--     after verifying the signed link). Members cannot forge customer confirmations.
--   * source = 'shopkeeper' rows are limited to kind = 'promise' (a wada the customer gave verbally).
-- Money is integer paisa. No floats.

-- ───────────────────────────────────────────── columns
alter table public.shops add column if not exists raast_id text
  check (raast_id is null or length(raast_id) between 4 and 40);
alter table public.customers add column if not exists link_nonce int not null default 0;

-- ───────────────────────────────────────────── attestations
create table if not exists public.attestations (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id) on delete cascade,
  seq             bigint not null,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  transaction_id  uuid references public.transactions(id) on delete cascade,
  kind            text not null check (kind in ('confirm', 'dispute', 'promise', 'paid_claim')),
  source          text not null check (source in ('customer', 'shopkeeper')),
  promise_date    date,
  amount_paisa    bigint not null default 0 check (amount_paisa >= 0),
  note            text check (note is null or length(note) <= 280),
  idempotency_key text not null,
  tx_entry_hash   text,
  prev_hash       text not null,
  entry_hash      text not null,
  created_at      timestamptz not null default now(),
  unique (shop_id, seq),
  unique (shop_id, idempotency_key),
  check ((kind in ('confirm', 'dispute')) = (transaction_id is not null)),
  check ((kind = 'promise') = (promise_date is not null)),
  check (kind <> 'paid_claim' or amount_paisa > 0),
  check (source = 'customer' or kind = 'promise')
);
create index if not exists attestations_shop_customer_idx on public.attestations (shop_id, customer_id, created_at desc);
create index if not exists attestations_tx_idx on public.attestations (transaction_id);

drop trigger if exists attestations_immutable_trg on public.attestations;
create trigger attestations_immutable_trg before update or delete on public.attestations
  for each row execute function private.guard_immutable();

alter table public.attestations enable row level security;
drop policy if exists attestations_member_read on public.attestations;
create policy attestations_member_read on public.attestations for select to authenticated
  using ((select public.is_shop_member(shop_id)));
revoke insert, update, delete on public.attestations from anon, authenticated;
grant select on public.attestations to authenticated;
grant all on public.attestations to service_role;

-- entry_hash = sha256(prev | id | customer | kind | source | tx_entry_hash | amount | promise_date | ts)
create or replace function private.attestation_hash(
  p_prev text, p_id uuid, p_customer uuid, p_kind text, p_source text, p_tx_hash text,
  p_amount bigint, p_promise date, p_at timestamptz
) returns text
language sql stable set search_path = '' as $$
  select encode(sha256(convert_to(concat_ws('|', p_prev, p_id::text, p_customer::text, p_kind, p_source,
    coalesce(p_tx_hash, '-'), p_amount::text, coalesce(p_promise::text, '-'), private.ts_text(p_at)), 'UTF8')), 'hex');
$$;

-- Latest confirm/dispute per transaction wins (append-only: a customer may change their answer).
create or replace function private.tx_attestation_status(p_tx uuid) returns text
language sql stable set search_path = '' as $$
  select a.kind from public.attestations a
  where a.transaction_id = p_tx and a.kind in ('confirm', 'dispute')
  order by a.seq desc limit 1;
$$;

-- ───────────────────────────────────────────── record_attestation
create or replace function public.record_attestation(p_shop_id uuid, p_customer_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  v_kind text := p_payload ->> 'kind';
  v_key text := nullif(p_payload ->> 'idempotency_key', '');
  v_source text;
  v_tx uuid := nullif(p_payload ->> 'transaction_id', '')::uuid;
  v_tx_hash text;
  v_promise date := nullif(p_payload ->> 'promise_date', '')::date;
  v_amount bigint := coalesce((p_payload ->> 'amount_paisa')::bigint, 0);
  v_note text := nullif(left(coalesce(p_payload ->> 'note', ''), 280), '');
  v_id uuid := gen_random_uuid();
  v_seq bigint; v_prev text; v_hash text; v_at timestamptz := now();
  v_existing public.attestations%rowtype;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  perform private.assert_member(p_shop_id);
  if v_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  if v_kind is null or v_kind not in ('confirm', 'dispute', 'promise', 'paid_claim') then
    raise exception 'BAD_REQUEST: unknown attestation kind';
  end if;
  -- only the signed-link route (service_role) may speak for the customer
  v_source := case when v_is_service then coalesce(nullif(p_payload ->> 'source', ''), 'customer') else 'shopkeeper' end;
  if v_source not in ('customer', 'shopkeeper') then raise exception 'BAD_REQUEST: bad source'; end if;
  if v_source = 'shopkeeper' and v_kind <> 'promise' then
    raise exception 'FORBIDDEN: only the customer can confirm, dispute or claim a payment' using errcode = '42501';
  end if;

  if not exists (select 1 from public.customers c where c.id = p_customer_id and c.shop_id = p_shop_id) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  perform private.lock_shop(p_shop_id);

  select * into v_existing from public.attestations a where a.shop_id = p_shop_id and a.idempotency_key = v_key;
  if found then
    return jsonb_build_object('ok', true, 'deduplicated', true, 'status', 'REPLAY_DEDUPLICATED', 'attestation_id', v_existing.id,
      'kind', v_existing.kind, 'entry_hash', v_existing.entry_hash, 'seq', v_existing.seq);
  end if;

  if v_kind in ('confirm', 'dispute') then
    if v_tx is null then raise exception 'BAD_REQUEST: transaction_id required'; end if;
    select t.entry_hash into v_tx_hash from public.transactions t
    where t.id = v_tx and t.shop_id = p_shop_id and t.customer_id = p_customer_id and t.type in ('sale', 'payment');
    if v_tx_hash is null then raise exception 'TX_NOT_FOUND'; end if;
    v_promise := null; v_amount := 0;
  elsif v_kind = 'promise' then
    if v_promise is null or v_promise < v_today or v_promise > v_today + 90 then
      raise exception 'BAD_REQUEST: promise_date must be within the next 90 days';
    end if;
    v_tx := null; v_amount := greatest(v_amount, 0);
  else -- paid_claim
    if v_amount <= 0 or v_amount > 100000000 then raise exception 'INVALID_AMOUNT'; end if;
    v_tx := null; v_promise := null;
  end if;

  select a.seq, a.entry_hash into v_seq, v_prev from public.attestations a
  where a.shop_id = p_shop_id order by a.seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, private.genesis_hash());
  v_hash := private.attestation_hash(v_prev, v_id, p_customer_id, v_kind, v_source, v_tx_hash, v_amount, v_promise, v_at);

  insert into public.attestations (id, shop_id, seq, customer_id, transaction_id, kind, source, promise_date, amount_paisa,
    note, idempotency_key, tx_entry_hash, prev_hash, entry_hash, created_at)
  values (v_id, p_shop_id, v_seq, p_customer_id, v_tx, v_kind, v_source, v_promise, v_amount,
    v_note, v_key, v_tx_hash, v_prev, v_hash, v_at);

  insert into public.audit_events (shop_id, event, payload)
  values (p_shop_id, 'attestation', jsonb_build_object('kind', v_kind, 'source', v_source, 'seq', v_seq, 'customer_id', p_customer_id));

  return jsonb_build_object('ok', true, 'deduplicated', false, 'attestation_id', v_id, 'kind', v_kind, 'source', v_source,
    'seq', v_seq, 'prev_hash', v_prev, 'entry_hash', v_hash, 'tx_entry_hash', v_tx_hash, 'created_at', v_at);
end $$;

-- ───────────────────────────────────────────── get_customer_statement (public link + shopkeeper view)
create or replace function public.get_customer_statement(p_shop_id uuid, p_customer_id uuid, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.assert_member(p_shop_id);
  select jsonb_build_object(
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'raast_id', s.raast_id),
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'balance_paisa', c.balance_paisa,
      'last_paid_at', c.last_paid_at, 'link_nonce', c.link_nonce),
    'entries', coalesce((
      select jsonb_agg(e order by (e ->> 'seq')::bigint desc) from (
        select jsonb_build_object(
          'transaction_id', t.id, 'seq', t.seq, 'type', t.type, 'created_at', t.created_at,
          'total_paisa', t.total_paisa, 'cash_paid_paisa', t.cash_paid_paisa, 'credit_paisa', t.credit_paisa,
          'entry_hash', t.entry_hash,
          'summary', (select string_agg(coalesce(p.name, 'Item'), ', ' order by tl.id)
                      from public.transaction_lines tl left join public.products p on p.id = tl.product_id
                      where tl.transaction_id = t.id),
          'status', coalesce(private.tx_attestation_status(t.id), 'pending')
        ) as e
        from public.transactions t
        where t.shop_id = p_shop_id and t.customer_id = p_customer_id
          and ((t.type = 'sale' and t.credit_paisa <> 0) or t.type = 'payment')
          and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)
        order by t.seq desc
        limit greatest(1, least(p_limit, 60))
      ) x
    ), '[]'::jsonb),
    'promise', (
      select jsonb_build_object('promise_date', a.promise_date, 'source', a.source, 'created_at', a.created_at,
        'amount_paisa', a.amount_paisa,
        'state', case when exists (select 1 from public.transactions t where t.shop_id = p_shop_id and t.customer_id = p_customer_id
                                    and t.type = 'payment' and t.created_at >= a.created_at
                                    and (t.created_at at time zone 'Asia/Karachi')::date <= a.promise_date) then 'kept'
                      when a.promise_date < (now() at time zone 'Asia/Karachi')::date then 'broken'
                      else 'open' end)
      from public.attestations a
      where a.shop_id = p_shop_id and a.customer_id = p_customer_id and a.kind = 'promise'
      order by a.seq desc limit 1),
    'paid_claims', coalesce((
      select jsonb_agg(jsonb_build_object('attestation_id', a.id, 'amount_paisa', a.amount_paisa, 'created_at', a.created_at)
                       order by a.seq desc)
      from public.attestations a
      where a.shop_id = p_shop_id and a.customer_id = p_customer_id and a.kind = 'paid_claim'
        and a.created_at > coalesce(c.last_paid_at, '-infinity'::timestamptz)
    ), '[]'::jsonb)
  ) into v
  from public.customers c join public.shops s on s.id = c.shop_id
  where c.id = p_customer_id and c.shop_id = p_shop_id;
  if v is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  return v;
end $$;

-- ───────────────────────────────────────────── per-customer badges for the Khata tab
create or replace function public.get_bharosa_overview(p_shop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_member(p_shop_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'customer_id', c.id,
      'confirmed', x.confirmed, 'disputed', x.disputed, 'pending', x.pending,
      'promise_date', pr.promise_date, 'promise_state', pr.state,
      'paid_claim_paisa', coalesce(pc.amount, 0)))
    from public.customers c
    cross join lateral (
      select count(*) filter (where st = 'confirm') confirmed,
             count(*) filter (where st = 'dispute') disputed,
             count(*) filter (where st is null) pending
      from (select private.tx_attestation_status(t.id) st from public.transactions t
            where t.shop_id = p_shop_id and t.customer_id = c.id and t.type = 'sale' and t.credit_paisa > 0
              and not exists (select 1 from public.transactions r where r.reversed_transaction_id = t.id)) s
    ) x
    left join lateral (
      select a.promise_date,
             case when exists (select 1 from public.transactions t where t.shop_id = p_shop_id and t.customer_id = c.id
                                and t.type = 'payment' and t.created_at >= a.created_at
                                and (t.created_at at time zone 'Asia/Karachi')::date <= a.promise_date) then 'kept'
                  when a.promise_date < (now() at time zone 'Asia/Karachi')::date then 'broken'
                  else 'open' end state
      from public.attestations a where a.shop_id = p_shop_id and a.customer_id = c.id and a.kind = 'promise'
      order by a.seq desc limit 1
    ) pr on true
    left join lateral (
      select sum(a.amount_paisa) amount from public.attestations a
      where a.shop_id = p_shop_id and a.customer_id = c.id and a.kind = 'paid_claim'
        and a.created_at > coalesce(c.last_paid_at, '-infinity'::timestamptz)
    ) pc on true
    where c.shop_id = p_shop_id
  ), '[]'::jsonb);
end $$;

-- ───────────────────────────────────────────── attestation chain verifier
create or replace function public.verify_attestation_chain(p_shop_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; v_prev text := private.genesis_hash(); v_calc text; v_n bigint := 0; v_expected bigint := 1; v_tx_hash text;
begin
  perform private.assert_member(p_shop_id);
  for r in select * from public.attestations a where a.shop_id = p_shop_id order by a.seq loop
    v_n := v_n + 1;
    if r.seq <> v_expected or r.prev_hash <> v_prev then
      return jsonb_build_object('ok', false, 'code', 'CHAIN_BROKEN', 'reason', 'ATTESTATION_LINK_MISMATCH', 'first_broken_seq', r.seq, 'checked', v_n);
    end if;
    if r.transaction_id is not null then
      select t.entry_hash into v_tx_hash from public.transactions t where t.id = r.transaction_id;
      if v_tx_hash is distinct from r.tx_entry_hash then
        return jsonb_build_object('ok', false, 'code', 'CHAIN_BROKEN', 'reason', 'ATTESTED_TX_CHANGED', 'first_broken_seq', r.seq, 'checked', v_n);
      end if;
    end if;
    v_calc := private.attestation_hash(r.prev_hash, r.id, r.customer_id, r.kind, r.source, r.tx_entry_hash, r.amount_paisa, r.promise_date, r.created_at);
    if v_calc <> r.entry_hash then
      return jsonb_build_object('ok', false, 'code', 'CHAIN_BROKEN', 'reason', 'ATTESTATION_HASH_MISMATCH', 'first_broken_seq', r.seq, 'checked', v_n);
    end if;
    v_prev := r.entry_hash;
    v_expected := v_expected + 1;
  end loop;
  return jsonb_build_object('ok', true, 'code', 'CHAIN_OK', 'checked', v_n, 'head_hash', v_prev);
end $$;

-- ───────────────────────────────────────────── shopkeeper settings
create or replace function public.update_shop_raast(p_shop_id uuid, p_raast_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_raast_id, '')), '');
begin
  perform private.assert_member(p_shop_id);
  if v is not null and (length(v) < 4 or length(v) > 40 or v !~ '^[A-Za-z0-9@._+ -]+$') then
    raise exception 'BAD_REQUEST: Raast ID must be a phone number, alias or IBAN';
  end if;
  update public.shops set raast_id = v where id = p_shop_id;
  return jsonb_build_object('ok', true, 'raast_id', v);
end $$;

-- Revoke every outstanding link for one customer (lost phone, wrong number).
create or replace function public.rotate_customer_link(p_shop_id uuid, p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  perform private.assert_member(p_shop_id);
  update public.customers set link_nonce = link_nonce + 1
  where id = p_customer_id and shop_id = p_shop_id returning link_nonce into v;
  if v is null then raise exception 'CUSTOMER_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true, 'link_nonce', v);
end $$;

-- ───────────────────────────────────────────── trade summary + Bharosa metrics
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
    'head_entry_hash', coalesce(v_hash, private.genesis_hash()),
    'bharosa', v_bharosa
  ) into v
  from public.shops s where s.id = p_shop_id;
  return v;
end $$;

-- ───────────────────────────────────────────── reset_demo_shop also clears attestations
create or replace function public.reset_demo_shop(p_shop_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.shops where id = p_shop_id and is_demo_shop) then
    raise exception 'NOT_A_DEMO_SHOP';
  end if;
  perform private.lock_shop(p_shop_id);
  perform set_config('dukaan.maintenance', 'on', true);
  delete from public.attestations where shop_id = p_shop_id;
  delete from public.idempotency_keys where shop_id = p_shop_id;
  delete from public.audit_events where shop_id = p_shop_id;
  delete from public.inventory_movements where shop_id = p_shop_id;
  delete from public.ledger_entries where shop_id = p_shop_id;
  delete from public.transaction_lines where shop_id = p_shop_id;
  delete from public.transactions where shop_id = p_shop_id;
  delete from public.sku_aliases where shop_id = p_shop_id;
  delete from public.products where shop_id = p_shop_id;
  delete from public.customers where shop_id = p_shop_id;
  update public.shops set raast_id = null where id = p_shop_id;
  perform set_config('dukaan.maintenance', 'off', true);
  v := private.seed_demo_shop(p_shop_id);
  insert into public.audit_events (shop_id, event, payload) values (p_shop_id, 'reset_demo_shop', v);
  return v;
end $$;

-- ───────────────────────────────────────────── grants
revoke all on function private.attestation_hash(text, uuid, uuid, text, text, text, bigint, date, timestamptz) from public, anon, authenticated;
revoke all on function private.tx_attestation_status(uuid) from public, anon, authenticated;
revoke all on function public.record_attestation(uuid, uuid, jsonb) from public, anon;
grant execute on function public.record_attestation(uuid, uuid, jsonb) to authenticated, service_role;
revoke all on function public.get_customer_statement(uuid, uuid, int) from public, anon;
grant execute on function public.get_customer_statement(uuid, uuid, int) to authenticated, service_role;
revoke all on function public.get_bharosa_overview(uuid) from public, anon;
grant execute on function public.get_bharosa_overview(uuid) to authenticated, service_role;
revoke all on function public.verify_attestation_chain(uuid) from public, anon;
grant execute on function public.verify_attestation_chain(uuid) to authenticated, service_role;
revoke all on function public.update_shop_raast(uuid, text) from public, anon;
grant execute on function public.update_shop_raast(uuid, text) to authenticated, service_role;
revoke all on function public.rotate_customer_link(uuid, uuid) from public, anon;
grant execute on function public.rotate_customer_link(uuid, uuid) to authenticated, service_role;
revoke all on function public.get_trade_summary(uuid, int) from public, anon;
grant execute on function public.get_trade_summary(uuid, int) to authenticated, service_role;
revoke execute on function public.reset_demo_shop(uuid) from public, anon, authenticated;
grant execute on function public.reset_demo_shop(uuid) to service_role;
