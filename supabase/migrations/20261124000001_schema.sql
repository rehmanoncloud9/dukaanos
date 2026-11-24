-- DukaanOS · 0001 · Canonical 11-table schema, RLS, integrity triggers
-- Money = integer paisa (bigint). Inventory = integer base units (g | ml | pcs). No floats anywhere.

create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ───────────────────────────────────────────── 1. shops
create table public.shops (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(name) between 1 and 120),
  owner_name    text,
  phone         text,
  city          text,
  is_demo_shop  boolean not null default false,
  is_stage_shop boolean not null default false,
  active_since  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- ───────────────────────────────────────────── 2. shop_members
create table public.shop_members (
  shop_id    uuid not null references public.shops(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'staff', 'judge')),
  created_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index shop_members_user_shop_idx on public.shop_members (user_id, shop_id);

-- ───────────────────────────────────────────── 3. customers
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references public.shops(id) on delete cascade,
  code          text,
  name          text not null,
  role_tag      text,
  phone         text,
  aliases       text[] not null default '{}',
  balance_paisa bigint not null default 0,        -- maintained ONLY by the ledger trigger
  last_paid_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (shop_id, code)
);
create index customers_shop_idx on public.customers (shop_id);
create index customers_name_trgm_idx on public.customers using gin (name extensions.gin_trgm_ops);

-- ───────────────────────────────────────────── 4. products
create table public.products (
  id                       uuid primary key default gen_random_uuid(),
  shop_id                  uuid not null references public.shops(id) on delete cascade,
  sku_code                 text not null,
  name                     text not null,
  name_ur                  text,
  base_unit                text not null check (base_unit in ('g', 'ml', 'pcs')),
  pack_size_base_units     bigint not null check (pack_size_base_units > 0),
  unit_price_paisa         bigint not null check (unit_price_paisa >= 0),
  cost_price_paisa         bigint not null default 0 check (cost_price_paisa >= 0),
  stock_base_units         bigint not null default 0,   -- maintained ONLY by inventory_movements trigger
  reorder_level_base_units bigint not null default 0,
  is_quick_added           boolean not null default false,
  created_at               timestamptz not null default now(),
  unique (shop_id, sku_code)
);
create index products_shop_idx on public.products (shop_id);
create index products_name_trgm_idx on public.products using gin (name extensions.gin_trgm_ops);

-- ───────────────────────────────────────────── 5. sku_aliases
create table public.sku_aliases (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  alias      text not null,
  unique (shop_id, alias)
);
create index sku_aliases_shop_idx on public.sku_aliases (shop_id);
create index sku_aliases_alias_trgm_idx on public.sku_aliases using gin (alias extensions.gin_trgm_ops);

-- ───────────────────────────────────────────── 6. transactions (hash-chained)
create table public.transactions (
  id                      uuid primary key default gen_random_uuid(),
  shop_id                 uuid not null references public.shops(id) on delete cascade,
  seq                     bigint not null,
  type                    text not null check (type in ('sale', 'payment', 'purchase', 'reversal')),
  customer_id             uuid references public.customers(id),
  supplier_name           text,
  reversed_transaction_id uuid references public.transactions(id),
  subtotal_paisa          bigint not null default 0,
  discount_paisa          bigint not null default 0 check (discount_paisa >= 0 or type = 'reversal'),
  total_paisa             bigint not null default 0,
  cash_paid_paisa         bigint not null default 0,
  credit_paisa            bigint not null default 0,
  idempotency_key         text not null,
  prev_hash               text not null,
  entry_hash              text not null,
  audit_meta              jsonb not null default '{}'::jsonb,
  actor_id                uuid,
  created_at              timestamptz not null default now(),
  unique (shop_id, idempotency_key),
  unique (shop_id, seq),
  check ((type = 'reversal') = (reversed_transaction_id is not null))
);
create index transactions_shop_created_idx on public.transactions (shop_id, created_at desc);
create index transactions_customer_idx on public.transactions (customer_id);
-- a transaction can be reversed at most once
create unique index transactions_single_reversal_idx on public.transactions (reversed_transaction_id) where type = 'reversal';

-- ───────────────────────────────────────────── 7. transaction_lines
create table public.transaction_lines (
  id                   uuid primary key default gen_random_uuid(),
  transaction_id       uuid not null references public.transactions(id) on delete cascade,
  shop_id              uuid not null references public.shops(id) on delete cascade,
  product_id           uuid references public.products(id),
  name_snapshot        text not null,
  base_unit            text not null check (base_unit in ('g', 'ml', 'pcs')),
  qty_base_units       bigint not null check (qty_base_units > 0),
  unit_price_paisa     bigint not null,
  pack_size_base_units bigint not null check (pack_size_base_units > 0),
  line_total_paisa     bigint not null,
  cost_total_paisa     bigint not null default 0,
  value_first          boolean not null default false,
  spoken               text
);
create index transaction_lines_tx_idx on public.transaction_lines (transaction_id);
create index transaction_lines_shop_idx on public.transaction_lines (shop_id);

-- ───────────────────────────────────────────── 8. ledger_entries (double entry; debit +, credit −)
create table public.ledger_entries (
  id             bigint generated always as identity primary key,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  shop_id        uuid not null references public.shops(id) on delete cascade,
  account_code   text not null check (account_code in ('1010', '1120', '1200', '2010', '4010', '4090', '5010')),
  customer_id    uuid references public.customers(id),
  amount_paisa   bigint not null check (amount_paisa <> 0),
  created_at     timestamptz not null default now()
);
create index ledger_entries_tx_idx on public.ledger_entries (transaction_id);
create index ledger_entries_shop_account_idx on public.ledger_entries (shop_id, account_code, created_at);
create index ledger_entries_customer_idx on public.ledger_entries (customer_id) where customer_id is not null;

-- ───────────────────────────────────────────── 9. inventory_movements
create table public.inventory_movements (
  id               bigint generated always as identity primary key,
  shop_id          uuid not null references public.shops(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  transaction_id   uuid references public.transactions(id) on delete cascade,
  delta_base_units bigint not null check (delta_base_units <> 0),
  reason           text not null check (reason in ('sale', 'purchase', 'reversal', 'opening', 'adjustment')),
  created_at       timestamptz not null default now()
);
create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at);
create index inventory_movements_shop_idx on public.inventory_movements (shop_id, created_at);

-- ───────────────────────────────────────────── 10. audit_events
create table public.audit_events (
  id         bigint generated always as identity primary key,
  shop_id    uuid references public.shops(id) on delete cascade,
  actor_id   uuid,
  event      text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_shop_idx on public.audit_events (shop_id, created_at desc);

-- ───────────────────────────────────────────── 11. idempotency_keys (in-RPC response cache)
create table public.idempotency_keys (
  shop_id         uuid not null references public.shops(id) on delete cascade,
  idempotency_key text not null,
  rpc             text not null,
  transaction_id  uuid,
  response        jsonb,
  created_at      timestamptz not null default now(),
  primary key (shop_id, idempotency_key)
);

-- ═════════════════════════════════════════════ integrity triggers

-- Ledger must balance per transaction (checked at COMMIT).
create or replace function private.assert_tx_balanced() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sum bigint;
begin
  select coalesce(sum(amount_paisa), 0) into v_sum from public.ledger_entries where transaction_id = new.transaction_id;
  if v_sum <> 0 then
    raise exception 'LEDGER_UNBALANCED: transaction % sums to %', new.transaction_id, v_sum;
  end if;
  return null;
end $$;

create constraint trigger ledger_balanced_trg
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function private.assert_tx_balanced();

-- Customer balances follow A/R postings — and nothing else.
create or replace function private.apply_ar_to_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.account_code = '1120' and new.customer_id is not null then
    perform set_config('dukaan.ledger_write', 'on', true);
    update public.customers set balance_paisa = balance_paisa + new.amount_paisa where id = new.customer_id;
    perform set_config('dukaan.ledger_write', 'off', true);
  end if;
  return null;
end $$;

create trigger ledger_ar_balance_trg
  after insert on public.ledger_entries
  for each row execute function private.apply_ar_to_balance();

create or replace function private.guard_balance_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.balance_paisa is distinct from old.balance_paisa
     and coalesce(current_setting('dukaan.ledger_write', true), 'off') <> 'on'
     and coalesce(current_setting('dukaan.maintenance', true), 'off') <> 'on' then
    raise exception 'BALANCE_IS_LEDGER_DERIVED: customers.balance_paisa can only change through ledger_entries';
  end if;
  return new;
end $$;

create trigger customers_balance_guard_trg
  before update on public.customers
  for each row execute function private.guard_balance_update();

-- Stock follows inventory_movements — and nothing else.
create or replace function private.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('dukaan.stock_write', 'on', true);
  update public.products set stock_base_units = stock_base_units + new.delta_base_units where id = new.product_id;
  perform set_config('dukaan.stock_write', 'off', true);
  return null;
end $$;

create trigger inventory_stock_trg
  after insert on public.inventory_movements
  for each row execute function private.apply_stock_movement();

create or replace function private.guard_stock_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stock_base_units is distinct from old.stock_base_units
     and coalesce(current_setting('dukaan.stock_write', true), 'off') <> 'on'
     and coalesce(current_setting('dukaan.maintenance', true), 'off') <> 'on' then
    raise exception 'STOCK_IS_MOVEMENT_DERIVED: products.stock_base_units can only change through inventory_movements';
  end if;
  return new;
end $$;

create trigger products_stock_guard_trg
  before update on public.products
  for each row execute function private.guard_stock_update();

-- Financial history is append-only (reset of demo shops runs in maintenance mode).
create or replace function private.guard_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('dukaan.maintenance', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  raise exception 'IMMUTABLE_LEDGER: % on % is not allowed — use reverse_transaction', tg_op, tg_table_name;
end $$;

create trigger transactions_immutable_trg before update or delete on public.transactions
  for each row execute function private.guard_immutable();
create trigger transaction_lines_immutable_trg before update or delete on public.transaction_lines
  for each row execute function private.guard_immutable();
create trigger ledger_entries_immutable_trg before update or delete on public.ledger_entries
  for each row execute function private.guard_immutable();
create trigger inventory_movements_immutable_trg before update or delete on public.inventory_movements
  for each row execute function private.guard_immutable();

-- ═════════════════════════════════════════════ RLS

create or replace function public.is_shop_member(p_shop_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_shop_member(uuid) from public, anon;
grant execute on function public.is_shop_member(uuid) to authenticated;

alter table public.shops               enable row level security;
alter table public.shop_members        enable row level security;
alter table public.customers           enable row level security;
alter table public.products            enable row level security;
alter table public.sku_aliases         enable row level security;
alter table public.transactions        enable row level security;
alter table public.transaction_lines   enable row level security;
alter table public.ledger_entries      enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.audit_events        enable row level security;
alter table public.idempotency_keys    enable row level security;

create policy shops_member_read on public.shops for select to authenticated
  using ((select public.is_shop_member(id)));
create policy shop_members_self_read on public.shop_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy customers_member_read on public.customers for select to authenticated
  using ((select public.is_shop_member(shop_id)));
create policy products_member_read on public.products for select to authenticated
  using ((select public.is_shop_member(shop_id)));
create policy sku_aliases_member_read on public.sku_aliases for select to authenticated
  using ((select public.is_shop_member(shop_id)));
create policy transactions_member_read on public.transactions for select to authenticated
  using ((select public.is_shop_member(shop_id)));
create policy transaction_lines_member_read on public.transaction_lines for select to authenticated
  using ((select public.is_shop_member(shop_id)));
create policy ledger_entries_member_read on public.ledger_entries for select to authenticated
  using ((select public.is_shop_member(shop_id)));
create policy inventory_movements_member_read on public.inventory_movements for select to authenticated
  using ((select public.is_shop_member(shop_id)));
create policy audit_events_member_read on public.audit_events for select to authenticated
  using ((select public.is_shop_member(shop_id)));
-- idempotency_keys: no client policy at all (RPC-internal cache)

-- Clients are read-only on every table; all mutations go through SECURITY DEFINER RPCs.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
revoke select on public.idempotency_keys from authenticated;
