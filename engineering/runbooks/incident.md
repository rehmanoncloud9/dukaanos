# Incident Response Runbook

## Severity Levels
- **SEV-1**: API down, `CHAIN_BROKEN`, data leak, or runaway Gemini spend.
- **SEV-2**: Degraded voice/parchi latency (> 5s), elevated 5xx rate, or Turnstile outage.

## Immediate Triage
1. **Check `/api/system/health` & `/api/app-config`**: confirm Supabase connectivity and Gemini model availability.
2. **Check Vercel Runtime Logs**: filter by `req_id` (`x-request-id` header) or `status >= 500`.
3. **Runaway AI Spend**: lower `AI_GLOBAL_DAILY_PKR_CAP` or per-kind caps in Vercel env vars and redeploy (takes < 60s), or revoke `GEMINI_API_KEY` in emergency.
4. **Ledger Tamper / `CHAIN_BROKEN`**: run `SELECT * FROM public.verify_ledger_chain('<shop_id>')` in Supabase SQL Editor; inspect `audit_events` for the shop.
5. **Post-Incident**: document root cause, timeline, and regression test before closing.
