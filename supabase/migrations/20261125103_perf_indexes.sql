-- DukaanOS · 20261125103 · Composite performance indexes for Pulse (<40ms) and State (<150ms)

create index if not exists transactions_shop_seq_desc_idx
  on public.transactions (shop_id, seq desc);

create index if not exists transactions_shop_customer_seq_idx
  on public.transactions (shop_id, customer_id, seq desc)
  where customer_id is not null;

create index if not exists transactions_shop_type_created_idx
  on public.transactions (shop_id, type, created_at desc);

create index if not exists ledger_entries_shop_customer_account_idx
  on public.ledger_entries (shop_id, customer_id, account_code)
  where customer_id is not null;

create index if not exists inventory_movements_shop_reason_created_idx
  on public.inventory_movements (shop_id, reason, created_at desc);
