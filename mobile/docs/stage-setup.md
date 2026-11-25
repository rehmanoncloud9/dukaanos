# Stage Phone Setup, Preview APK & OTA Runbook

## 1. Environment & EAS Build Profiles (`mobile/eas.json`)

Set the following public environment variables in EAS (`eas env:create` — **never commit `.env` files or keystores**):
- `EXPO_PUBLIC_API_URL` (`https://<prod-web-host>`)
- `EXPO_PUBLIC_SUPABASE_URL` (`https://<project>.supabase.co`)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (`<anon-key>`)
- `EXPO_PUBLIC_ED25519_PUBLIC_KEY` (`<64-char hex public key>`)

Note: `mobile/app.config.ts` aborts any `EAS_BUILD=true` build if any required `EXPO_PUBLIC_*` variable is missing or non-HTTPS.

### Build commands (run from `mobile/`)
```bash
# 1. Stage / tester preview APK (direct sideload onto stage phones A/B/C)
eas build --platform android --profile preview

# 2. Play Console internal testing AAB
eas build --platform android --profile production

# 3. Submit production AAB to Google Play internal track
eas submit --platform android --profile production
```

---

## 2. Stage Phones Preparation (Phones A, B, C)

Prepare at least two identical primary/standby Android handsets + one judge inspection phone:
1. Download the signed `preview` APK from EAS build output URL (or scan the EAS build QR code on each phone).
2. Install the APK (`adb install -r dukaano-preview.apk` or tap downloaded APK in Chrome).
3. Launch **DukaanOS** and confirm:
   - Phone A / Standby Phone B: Sign in via **Stage login** (`stage@dukaanos.pk` + PIN) or dedicated **Try Live Demo Shop** sandbox depending on demo script; verify **Bismillah Kiryana** loads and `Chain OK`.
   - Phone C (Auditor / Judge Phone): Do **not** sign in; test scanning projector SMEConnect QR code to open `/passport` / `/verify` directly via App Links (`dukaanos://` / `https://<host>/verify`).
4. Disable battery optimization for **DukaanOS** on budget Android phones (Android 10–12) so recording & offline sync are never killed in background.
5. Enable **Stay awake** in Developer Options on Phone A before going on stage.

---

## 3. Auditorium Mirroring & Drills

### `scrcpy` Wired USB Mirroring (Recommended for stage projector)
```bash
adb devices
scrcpy --max-size=1080 --bit-rate=8M --turn-screen-off=false --stay-awake
```

### Pre-Stage 5-Minute Drill
1. **Wi-Fi OFF -> Speak/Type -> Wi-Fi ON:** Toggle Airplane Mode or Settings `Simulate Offline: ON`, log a sale, confirm amber offline banner increments `Pending Sync`, toggle back online and confirm FIFO flush completes with `0` duplicate entries.
2. **Real-Audio Replay Backup:** Hold Munshi Mic once in green room to archive a clean clip (`replay_clips` SQLite table). If auditorium mic echo interferes on stage, open `Settings -> Real-audio replay library` (or long-press shop title on Munshi) and replay through live pipeline.
3. **Hot-Standby Switch:** Keep Phone B signed into the same stage/demo state on a second USB cable ready for instant HDMI/USB switch if Phone A drops frame.

---

## 4. OTA Updates (`eas update`) & Rollback Policy

`app.config.ts` pins `"runtimeVersion": { "policy": "appVersion" }`.

- **When OTA is allowed:** JS/TS logic fixes, i18n copy, UI adjustments that require **zero** native dependency or `app.config.ts` changes.
  ```bash
  eas update --branch production --message "Fix Khata badge spacing"
  ```
- **When OTA is FORBIDDEN:** Any upgrade to Expo SDK, new native package (`expo-*`), permission change, icon/splash change, or native build config change. Ship a fresh `eas build --profile production` AAB/APK instead.
- **Instant Rollback:**
  ```bash
  eas update:rollback --branch production
  ```
