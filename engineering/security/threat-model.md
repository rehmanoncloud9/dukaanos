# STRIDE Threat Model — DukaanOS

| Surface | Threat | Mitigation |
|---|---|---|
| **API AuthN/Z** | Forged/expired JWTs or cross-tenant access (Spoofing / Elevation) | `requireUser()` validates JWT via Supabase Auth; Postgres RLS (`is_shop_member`) + `private.assert_member(p_shop_id)` on every RPC. |
| **Voice & Parchi Input** | Prompt injection or oversized media DoS (Tampering / DoS) | MIME `.startsWith()` checks, 5 MB body limit in `src/proxy.ts`, 0 write tools bound to Gemini, deterministic server-side math. |
| **AI Cost Abuse** | Unbounded Gemini calls exhausting budget (DoS / Financial) | `consume_ai_quota` enforces per-shop daily caps + `AI_GLOBAL_DAILY_PKR_CAP` before every model call. |
| **Demo & Sandbox Endpoints** | Automated bot creation of thousands of shops (DoS) | Persistent `consume_rate_limit` (10/hr per IP), Cloudflare Turnstile verification, 72h `purge_stale_sandboxes` cron, `DEMO_RESET_SECRET` gating `stage@dukaanos.pk`. |
| **Passport Signing Key** | Key compromise allows forged trade summaries (Repudiation) | `ED25519_PRIVATE_KEY` server-only; CI scans `.next/static` to ensure zero leakage; rotation runbook in `engineering/runbooks/secrets.md`. |
| **Mobile Device** | Stolen device / offline queue tampering (Info Disclosure) | Expo SecureStore for tokens, HTTPS-only transport, `idempotency_key` deduplication, server-side recomputation of all totals. |
