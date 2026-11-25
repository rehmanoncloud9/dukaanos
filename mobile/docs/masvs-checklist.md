# OWASP MASVS Security Assurance Checklist — DukaanOS Mobile (`pk.dukaanos.app`)

Audit baseline: OWASP MASVS v2 against `mobile/` source + config. Code-level controls are verified directly in source and Jest tests; APK binary / dynamic device items marked **PENDING** must be verified against the built `preview` APK and `production` AAB prior to public rollout.

---

## Summary Matrix

| MASVS Domain | Control | Status | Evidence / Reference |
| :--- | :--- | :--- | :--- |
| **STORAGE-1** | Auth tokens stored exclusively in hardware/Keystore-backed SecureStore (`expo-secure-store`), never AsyncStorage/SQLite | **PASS (Code)** | `mobile/src/core/auth/storage.ts` (chunked `expo-secure-store`, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), `mobile/test/core/secure-storage.test.ts` |
| **STORAGE-2** | Offline queue & shop cache live strictly in app-private storage (`SQLite` + `Paths.document/queue`) | **PASS (Code)** | `mobile/src/core/offline/db.ts`, `mobile/src/core/offline/queue.ts`, `mobile/test/core/offline-queue.test.ts` |
| **STORAGE-3** | Full local storage & query cache wipe on sign-out / account deletion | **PASS (Code)** | `mobile/src/core/auth/SessionProvider.tsx` (`clearQueueAndCacheStorage()` + `mobileQueryClient.clear()`) |
| **STORAGE-4** | Android cloud backup disabled (`android:allowBackup="false"`) | **PASS (Config)** | `mobile/app.config.ts` (`android.allowBackup: false`) |
| **CRYPTO-1** | SMEConnect QR Trade Passport verified on-device via Ed25519 against pinned public key (`EXPO_PUBLIC_ED25519_PUBLIC_KEY`) | **PASS (Code)** | `mobile/src/features/passport/verify.ts` (`verifyPassportOnDevice`), `mobile/src/features/passport/PassportScreen.tsx`, `mobile/test/features/passport.test.ts` |
| **CRYPTO-2** | No custom symmetric/hash crypto reimplementation; Noble Ed25519 + Postgres SHA-256 chain only | **PASS (Code)** | `@passport` (`src/lib/crypto/passport.ts`) + `apiClient.chain()` |
| **AUTH-1** | Automatic 401 refresh + single replay without duplicate writes (`idempotency_key`) | **PASS (Code)** | `mobile/src/core/api/client.ts`, `mobile/test/core/api-client.test.ts` |
| **AUTH-2** | Optional biometric / device PIN app lock after 2 min background grace | **PASS (Code)** | `mobile/src/core/security/AppLockGate.tsx` (`expo-local-authentication`) |
| **AUTH-3** | Account deletion enforces recent auth (<5 min JWT) or password re-entry + typed `"DELETE"` / `"حذف"` confirmation | **PASS (Code)** | `src/app/api/account/delete/route.ts`, `mobile/src/features/settings/SettingsScreen.tsx`, `mobile/test/features/settings.test.ts` |
| **NETWORK-1** | HTTPS strictly enforced outside local dev (`localhost` / `10.0.2.2` only in debug) | **PASS (Code)** | `mobile/src/core/config.ts` + `mobile/app.config.ts` (`EAS_BUILD=true` aborts without `https://`) |
| **NETWORK-2** | No custom TLS trust managers or certificate-bypass hooks; OS TLS verification active | **PASS (Code)** | Standard React Native `fetch` without custom native trust overrides |
| **PLATFORM-1** | Minimal runtime permissions (`RECORD_AUDIO`, `CAMERA` only) + broad `blockedPermissions` list | **PASS (Config)** | `mobile/app.config.ts` (blocks `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, location, `READ_MEDIA_*`, `SYSTEM_ALERT_WINDOW`) |
| **PLATFORM-2** | Deep links (`dukaanos://` and `/verify`) Zod-validated strictly for path, UUID, and JWT-like token shape | **PASS (Code)** | `mobile/src/core/security/deepLinks.ts` |
| **PLATFORM-3** | WebView isolated strictly to Cloudflare Turnstile challenge (`TurnstileModal.tsx`) | **PASS (Code)** | `mobile/src/core/auth/TurnstileModal.tsx` (navigation allow-list, no privileged JS bridge) |
| **PLATFORM-4** | Merged `AndroidManifest.xml` exported activities & App Links `autoVerify` inspected in built APK | **PENDING (Build)** | Run `apktool d app-release.apk` / Android Studio APK Analyzer after EAS build |
| **CODE-1** | `console.*` stripped from production JS bundle via Metro Terser minifier | **PASS (Config)** | `mobile/metro.config.js` (`drop_console: true`) + redacted `secureLog.ts` |
| **CODE-2** | Dependency vulnerability audit (`npm audit --omit=dev`) + static APK scan (MobSF / `apktool`) | **PENDING (Build)** | Run `cd mobile && npm audit --omit=dev` and MobSF scan once EAS APK/AAB artifact is generated |
| **RESILIENCE-1** | Hermes bytecode compilation enabled by default on Expo SDK 58 Android builds | **DOCUMENTED** | Standard Hermes bytecode baseline; server-enforced RLS (`auth.uid()`), hash chain, and Ed25519 signature remain source of truth (no client-side secrets stored). |

---

## Release Signing & App Links Tasks (Before Play Internal Track Release)
1. Run `eas credentials -p android` to obtain the EAS Upload Key + Play App Signing SHA-256 certificate fingerprints.
2. Replace the placeholder fingerprint in `public/.well-known/assetlinks.json` and deploy web host.
3. Share `pk.dukaanos.app` + SHA-256 fingerprint + `dukaanos://` scheme with backend owner (P1) for Supabase Auth redirect allow-list.
4. Inspect `AndroidManifest.xml` from `eas build -p android --profile production` via `apktool` to confirm zero unintended exported receivers/providers and verify `allowBackup="false"`.
