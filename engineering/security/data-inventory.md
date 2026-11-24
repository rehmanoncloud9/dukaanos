# Data Inventory & Classification (PDPB & Google Play Compliance)

| Table / Field | Classification | Purpose | Retention | Access |
|---|---|---|---|---|
| `shops` (`name`, `owner_name`, `phone`, `city`) | PII (Contact) | Shop profile & Passport header | Until account deletion (72h for sandboxes) | Shop members (RLS) |
| `customers` (`name`, `phone`, `role_tag`, `balance_paisa`) | PII (Customer) | Udhaar khata & WhatsApp/SMS reminders | Until account deletion | Shop members (RLS) |
| `transactions`, `transaction_lines`, `ledger_entries` | Financial | Double-entry hash-chained khata | Until account deletion (append-only) | Shop members (RLS) |
| `ai_usage` (`calls`, `tokens`, `est_cost_micros`) | Telemetry | Daily cost & quota enforcement | Until shop deletion | Shop members (select-only) |
| `account_deletion_audit` (`user_id_hash`) | Audit | Compliance proof of deletion (one-way SHA-256) | Indefinite (non-PII hash) | Service role only |
| Audio / Parchi images | Ephemeral | Real-time transcription / OCR | **0s server-side** (never persisted) | Transient in-memory |

**Data minimisation:** Zero CNIC, NTN, FBR, or biometric fields are collected or stored.
