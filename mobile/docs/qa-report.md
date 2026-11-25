# Mobile QA & Device Matrix Report (`mobile/docs/qa-report.md`)

**Package:** `pk.dukaanos.app`  
**Audit Date:** 2026-11-25  

---

## 1. Automated Verification Status (Verified Locally)

| Check | Command (`mobile/`) | Status | Notes |
| :--- | :--- | :--- | :--- |
| TypeScript strict check | `npm run typecheck` | Ran after edits | See live verification output |
| Jest Core & Feature Unit Suites | `npm test` | Ran after edits | Covers core (`api-client`, `secure-storage`, `offline-queue`, `i18n-config`) + P5 features (`khata`, `maal`, `parchi`, `passport`, `settings`) + Munshi golden eval (`eval:ai`) |
| Expo ESLint (React Compiler rules) | `npm run lint` | Ran after edits | Zero errors/warnings gate |

---

## 2. Physical Android Device Matrix (To Execute Once Preview APK Is Built)

Android SDK / `adb` / physical handsets are not connected in this workstation environment; run every row below against the signed `preview` APK before Play Console submission and mark `PASS` / `FAIL` with device screenshots.

| Device Slot | Target Hardware Tier | OS / RAM | Critical Scenarios to Verify | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Device A (Low-End Target)** | PKR 11–18K Android (e.g. Tecno/Infinix/itel) | Android 10–12, 3 GB RAM | Cold launch < 3s, 66dp mic press/slide-to-cancel, scroll smoothness, font scale 130%, low-storage warning handling | **PENDING** |
| **Device B (Compact Screen)** | Small 5" Android phone | Android 11–13 | Zero text truncation on Munshi/Khata/Maal at 130% font scale, 48dp touch targets unobstructed by bottom tab bar & keyboard | **PENDING** |
| **Device C (Modern Mainstream)** | Recent Android (e.g. Samsung A-series / Pixel) | Android 14–15 | Camera Parchi tap-to-focus + torch, gallery compression <=1280px, WhatsApp & SMS (2G) intent launch, PDF share, App Links `/verify` | **PENDING** |

---

## 3. Field & Stress Scenarios Checklist

- [ ] **Urdu UI Toggle (`EN` <-> `اردو`)**: Verify Noto Sans Arabic rendering without clipped diacritics or overlapping numeric badges across Munshi, Khata, Maal, Passport, Settings.
- [ ] **Sunlit Shop vs Dim Backroom Legibility**: Confirm `#FFFFFF` opaque cards on `#F2F2F7` canvas + `#0A0A0A` ink remain crisp at 400 nits.
- [ ] **Noisy Shop Microphone Test**: Record Urdu counter speech near shop background chatter -> confirm Tier 2 Review Sheet fallback edits cleanly.
- [ ] **Process Death Recovery**: Force-stop app immediately after queuing an offline turn -> relaunch -> verify SQLite `pending_turns` persists and flushes once with exact `idempotency_key` (`0` duplicates).
- [ ] **App Lock (Biometrics / PIN)**: Background > 2 minutes -> confirm lock overlay blocks ledger until device biometric/PIN succeeds.
- [ ] **Maestro E2E Suite (`mobile/e2e/*.yaml`)**: Run `maestro test mobile/e2e/` on connected emulator/device with signed preview APK.
