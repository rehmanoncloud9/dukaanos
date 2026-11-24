# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in DukaanOS, please report it privately to the security team at **security@dukaanos.pk** rather than opening a public GitHub issue.

Include:
- Affected endpoint, component, or migration
- Steps to reproduce or proof-of-concept
- Potential impact

We acknowledge reports within 24 hours and target remediation within 48 hours for critical/high findings.

## Security Architecture Summary

- **Authentication**: Supabase Auth JWTs validated server-side via `requireUser()` on every protected route.
- **Authorization**: Postgres Row Level Security (`TO authenticated`, `(select auth.uid())`, indexed `shop_id`) + `SECURITY DEFINER` RPCs with `SET search_path = ''` and `private.assert_member(shop_id)`.
- **Financial Integrity**: Append-only, SHA-256 hash-chained `transactions` and double-entry `ledger_entries` (`SUM = 0` deferred constraint trigger).
- **AI Safety**: Models bind only read/propose tools (`0` write tools); all financial arithmetic runs deterministically in TypeScript/Postgres.
