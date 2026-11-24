# ADR 0001: Hash-Chained Double-Entry Ledger

- **Status**: Accepted
- **Date**: 2026-11-24

## Context
Kiryana shopkeepers and external lenders (SBP SMEConnect) require tamper-evident financial records without blockchain gas fees or eventual-consistency delays.

## Decision
Every financial mutation (`commit_sale`, `record_payment`, `record_purchase`, `reverse_transaction`) runs inside a single Postgres transaction under a per-shop advisory lock (`pg_advisory_xact_lock`), writes balanced `ledger_entries` (`SUM(amount_paisa) = 0` enforced by a deferred constraint trigger), and computes `entry_hash = sha256(prev_hash | tx_id | type | total | timestamp | ledger_digest)`. `transactions`, `transaction_lines`, `ledger_entries`, and `inventory_movements` are protected by `IMMUTABLE_LEDGER` triggers.

## Consequences
- Zero floating-point drift (integer paisa and integer base units `g | ml | pcs`).
- `verify_ledger_chain` recomputes every hash and confirms `SUM(ledger_entries) = 0` in SQL.
- Corrections are always explicit `reverse_transaction` entries, preserving auditability.
