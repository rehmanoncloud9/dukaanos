# Backup & Restore Runbook

## Daily Backups
- Supabase Pro provides automated daily physical backups + Point-in-Time Recovery (PITR).
- For Free/Starter or secondary offsite backups, run `pg_dump "$DATABASE_URL" --no-owner --no-acl -Fc -f backup-$(date +%F).dump`.

## Restore Drill Procedure (into a scratch Supabase project)
1. Provision a scratch Supabase project (`ap-south-1`).
2. Apply schema & RPCs: `DATABASE_URL=<scratch_url> npx tsx scripts/db-apply.ts` (or `pg_restore` from dump).
3. Verify integrity:
   - Run `SELECT verify_ledger_chain(id) FROM public.shops;` — every shop must return `ok: true` and `ledger_sum_paisa: 0`.
   - Run `npm run smoke -- <scratch_url>` against a staging app pointed at the scratch DB.
4. Record the drill date, duration, and `verify_ledger_chain` output in the release log.
