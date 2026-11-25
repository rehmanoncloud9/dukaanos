# DukaanOS Mobile

Expo (React Native + TypeScript + Expo Router) Android and iOS client for DukaanOS.

## Setup

```bash
cd mobile
npm ci
cp .env.example .env
```

Set the public variables in `.env`:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_ED25519_PUBLIC_KEY`

## Commands

```bash
npm start      # Expo dev server
npm run android
npm run verify # TypeScript + Jest unit tests
npm run eval:ai
npm run lint
```

## External APIs & Libraries

- **Backend & AI API (`/api/*`):** Connects over HTTPS to the DukaanOS Next.js API (Gemini voice/parchi/Q&A endpoints, TTS audio synthesis, PostgreSQL hash-chained ledger RPCs).
- **Auth & Verification:** Supabase Auth (`@supabase/supabase-js`) with `expo-secure-store`, Cloudflare Turnstile challenge (`react-native-webview`), and `expo-local-authentication`.
- **Offline Storage & State:** `expo-sqlite`, `expo-file-system`, `@react-native-community/netinfo`, `@tanstack/react-query`, and `zod`.
- **UI, Media & Crypto:** Expo Router, `react-native-reanimated`, `react-native-gesture-handler`, `@gorhom/bottom-sheet`, `@shopify/flash-list`, `lucide-react-native`, `expo-audio`, `react-native-view-shot`, `expo-sharing`, `@noble/ed25519`, `@noble/hashes`, and `expo-crypto`.
- **Shared Domain:** Imports `@domain/*`, `@contracts`, and `@passport` read-only from `../src/lib/` (see `src/core/README.md`).
