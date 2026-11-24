# Secrets Rotation Runbook

## Inventory
- `SUPABASE_SERVICE_ROLE_KEY` — server-only admin DB/Auth key
- `GEMINI_API_KEY` — billed Google AI key
- `ED25519_PRIVATE_KEY` / `NEXT_PUBLIC_ED25519_PUBLIC_KEY` — Trade Passport signing keypair
- `DEMO_RESET_SECRET` — protects `stage@dukaanos.pk` reset/tamper
- `CRON_SECRET` — protects `/api/demo/purge`
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile server verification

## Rotation Procedure
1. **Supabase Service Role Key**: Rotate in Supabase Dashboard → Settings → API → update Vercel env var → redeploy.
2. **Gemini API Key**: Create new key in Google AI Studio → update `GEMINI_API_KEY` in Vercel → redeploy → revoke old key.
3. **Ed25519 Passport Key**: Generate new keypair (`npm run setup` or `@noble/ed25519`), update `ED25519_PRIVATE_KEY` and `NEXT_PUBLIC_ED25519_PUBLIC_KEY` in Vercel, redeploy. Note: previously issued Passport QR tokens signed with the old key will no longer verify against the new public key.
4. **CRON_SECRET / DEMO_RESET_SECRET**: Generate 32-byte random hex (`openssl rand -hex 32`), update Vercel env vars, redeploy.
