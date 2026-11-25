# Google Play Data Safety Form — DukaanOS (`pk.dukaanos.app`)

Matches live `/privacy` (`src/app/(legal)/privacy/page.tsx`) and `/delete-account` (`src/app/delete-account/page.tsx`).

## Overview Answers
- **Does your app collect or share any of the required user data types?** Yes
- **Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS / TLS strictly enforced in `mobile/src/core/config.ts`)
- **Do you provide a way for users to request that their data is deleted?** Yes
  - In-app deletion: `Settings → Delete account` (`POST /api/account/delete`)
  - Web deletion URL (no app required): `https://<PROD_WEB_HOST>/delete-account`

---

## Data Types Collected

| Category | Data Type | Collected? | Shared with 3rd parties? | Ephemeral processing? | Required or Optional? | Purpose(s) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Personal info** | Email address | Yes | No (Auth via Supabase processor only) | No | Required for non-sandbox accounts (sandbox uses anonymous ephemeral email) | Account management, authentication |
| **Financial info / Business records** | Shop ledger, customer names/phones, inventory items | Yes | No | No | User-entered core functionality | App functionality (bookkeeping, khata, receipts, optional user-initiated SMEConnect PDF/QR export) |
| **Audio files** | Voice recordings | Yes | Sent transiently to Gemini API processor only | **Yes** — discarded server-side after parsing; offline queue deleted after sync | Optional (typed input fallback always available) | App functionality (speech-to-ledger transcription) |
| **Photos and videos** | Wholesale parchi photos | Yes | Sent transiently to Gemini API processor only | **Yes** — discarded server-side after OCR parsing | Optional | App functionality (OCR line extraction) |
| **App info and performance** | Crash / operational telemetry (redacted, no PII) | Minimized | No | Local diagnostics only (`console.*` stripped in release bundle) | N/A | Security, reliability, fraud/abuse rate-limiting |

## Explicitly NOT Collected
- **CNIC / National ID / Tax ID (NTN / STRN)** — Never collected.
- **Precise or approximate Location** — Explicitly blocked via `blockedPermissions` in `app.config.ts`.
- **Contacts list / Call logs / SMS inbox** — WhatsApp & SMS reminders launch via OS URL intents (`wa.me:` / `sms:`); contacts permission is never requested.
- **Media library broad access** — Gallery uses Android photo picker (`expo-image-picker`) without `READ_EXTERNAL_STORAGE` or `READ_MEDIA_*` permissions.
- **Third-party advertising SDKs / data brokers** — None. Zero data sold or shared for advertising.
