# GitHub Branch Protection & CI Runbook

## Branch Protection on `main`

Configure **Settings → Branches → Branch protection rules** for `main`:

1. **Require a pull request before merging**
   - Require approvals: `1` (or `0` only during solo emergency hotfixes after Fri Nov 27 freeze).
   - Dismiss stale pull request approvals when new commits are pushed.
2. **Require status checks to pass before merging**
   - Require branches to be up to date before merging (`git pull --rebase origin main`).
   - Required status checks:
     - `web-api-verify`
     - (`mobile-verify` runs automatically when `mobile/**` changes; add as required once `mobile/` exists).
3. **Do not allow bypassing the above settings** (including admins, unless emergency).
4. **Restrict force pushes** and **block deletions** on `main`.

## Local Pre-Push Checklist

Every teammate must run before pushing:

```powershell
git status          # Confirm team/, next-phase/, docs/, design-ref/, PLAN.md, AGENTS.md, CLAUDE.md are NOT listed
npx next typegen
npm run lint
npm run verify
```

## Commit Hygiene

- Conventional Commits (`feat:`, `fix:`, `chore:`, `sec:`, `docs:`, `test:`).
- One concern per commit, imperative mood.
- Never commit `.env*` (except `.env.example`) or any secret.
