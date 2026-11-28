# DukaanOS — Pakistan's Zero-Literacy Financial Compiler

**GDGoC NUST × Capital Youth Expo (CYE 2026) · Innovation Sprint · Track: FinTech & Financial Inclusion**

> **Your khata. Your voice.** DukaanOS compiles chaotic, code-switched Urdu / Punjabi / English counter speech and crinkled handwritten wholesale *parchis* into **SHA-256 hash-chained, double-entry Postgres ledgers**, proactive cash-flow & margin alerts, and an **Ed25519 QR-verifiable Trade Passport** — without ever letting an LLM write to the books or do arithmetic.

> *Sirf Aap Ka Record — Zero FBR Linkage.* Private *udhaar* recovery. No CNIC, no tax fields, owner-consented exports only.

---

## Submission Links (CYE 2026)

| Item | Link / Status |
|---|---|
| **Track** | FinTech & Financial Inclusion *(also applies Urdu & Regional Tech)* |
| **Public Repository** | [github.com/rehmanoncloud9/dukaanos](https://github.com/rehmanoncloud9/dukaanos) |
| **Live Web App** | [dukaanos-xi.vercel.app](https://dukaanos-xi.vercel.app) *(verified live in Private/Incognito window)* |
| **Demo Video (≤ 2 min)** | *Add unlisted YouTube / Google Drive link here* |
| **Pitch Deck (PDF / PPTX)** | *Add public PDF / PPTX link here* |
| **Design System** | [`DESIGN.md`](DESIGN.md) |
| **Security Policy** | [`SECURITY.md`](SECURITY.md) |

---

## 1. What It Does & Who It's For

### The Problem
Over **2 million neighborhood *kiryana* and retail merchants (*dukaandars*)** in Pakistan run their entire daily cash flow on paper *khata* notebooks, mental math, and crinkled handwritten wholesale *parchis*. Existing accounting and POS software fails them on four fronts:
- **Typing & English-first UX collapse at the counter:** Orders arrive at rush hour in rapid, code-switched Urdu, Punjabi, and English (*"Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein"*).
- **Silent profit erosion:** Wholesale *parchi* rates creep up unnoticed, slow stock ties up working capital for 45+ days, and *udhaar* slips past 15 days.
- **Unreliable connectivity & noisy counters:** 2G/flaky connections drop cloud-only apps, while naive voice assistants clip first words, talk over shopkeepers, or ignore back-to-back orders.
- **Zero verifiable credit history:** Profitable merchants remain locked out of supplier credit and SME financing because paper notebooks cannot be audited or verified.

### The Solution
DukaanOS is a **voice-first, offline-resilient, daylight-legible PWA + Expo mobile companion** engineered for low-cost Android phones (`PKR 11k–18k`) and busy retail counters:
1. **Speak hands-free or snap a *parchi*:** Hold-to-talk, continuous **Walkie-Talkie Counter Mode** (with pre-roll, barge-in, and pipelined queueing), or **Parchi OCR** captures transactions in seconds.
2. **AI extracts mentions; deterministic code compiles money:** Gemini never touches the database or computes totals. **PakPhone**, **desi-units**, and **integer-paisa** Postgres RPCs guarantee exact double-entry books (`SUM(ledger_entries) = 0`).
3. **Proactive margin defense & verifiable credit proof:** Daily **Aaj Ki Salah** Urdu briefings, **Margin Shield**, **EOD *Galla* Reconciliation**, **Mutual Khata**, and an **Ed25519-signed Trade Passport** verifiable in any browser via QR code at `/verify`.

---

## 2. Why DukaanOS Wins (CYE 2026 Judging Alignment)

| CYE Judging Pillar | How DukaanOS Delivers Beyond a Prototype | Verified Proof |
|---|---|---|
| **25% Innovation** | **LLM-as-extractor-only + Deterministic Compiler** architecture; continuous **Walkie-Talkie PCM Pre-Roll + TTS Barge-In + Pipelined FIFO Queue**; offline `<5 ms` **PakPhone** phonetic matcher; **SHA-256 hash-chained** ledger; client-verified **Ed25519 Trade Passport**. | [`munshi.ts`](src/lib/ai/munshi.ts), [`WalkieTalkieBar.tsx`](src/components/WalkieTalkieBar.tsx), [`pakphone.ts`](src/lib/domain/pakphone.ts), [`passport.ts`](src/lib/crypto/passport.ts) |
| **25% Technical Execution** | **13 Postgres migrations**, 4 atomic PL/pgSQL RPCs, strict RLS, **200-way concurrent idempotency proof**, **5,000+ SKU scaling** (`<20 ms` inverted phonetic index), and real-Postgres `PGlite` tests. | `npm run verify`: **35 test files / 357 tests passed** · `npm run eval`: **15/15 PASS** · `tsc --noEmit`: **0 errors** |
| **25% Real-World Impact** | Built for real Pakistani shop economics: `Margin Shield` catches inflation losses, `Aaj Ki Salah` flags Friday stockouts & 45-day dead stock, `idb-keyval` offline queue preserves clips on 0-signal, and **API cost optimizations** cut runtime LLM spend by **40–70%**. | [`margin-shield.ts`](src/lib/domain/margin-shield.ts), [`aaj-ki-salah.ts`](src/lib/domain/aaj-ki-salah.ts), [`queue.ts`](src/lib/client/queue.ts) |
| **25% Pitch & UI/UX** | **Daylight-contrast 3-tab UI** (`فروخت / ادھار / گودام`) with 48px+ targets, 5-second Undo, 3-Ali disambiguation chips, natural **`ur-PK-AsadNeural`** Urdu audio readouts, dual **`wa.me` + native `sms:`** recovery, and **`/report` + `/verify`** live demo proof. | [`DESIGN.md`](DESIGN.md), [`MunshiTab.tsx`](src/components/MunshiTab.tsx), [`KhataTab.tsx`](src/components/KhataTab.tsx), [`src/app/verify/`](src/app/verify) |

---

## 3. Core Features, Production Optimizations & Architecture

### Shipped Features (Web PWA + Mobile Companion)

| Area | Capability | Implementation |
|---|---|---|
| **Walkie-Talkie Counter Mode** | Continuous hands-free counter listening with **450 ms PCM ring-buffer pre-roll** (`16 kHz` mono WAV — zero clipped first syllables), **asymmetric noise-floor VAD + hysteresis** (works in noisy shops, not just dead silence), **true TTS barge-in** (`stopSpeaking()` interrupts playback when the shopkeeper speaks), and a **pipelined FIFO segment queue** (captures new orders while the previous order is still processing). | [`WalkieTalkieBar.tsx`](src/components/WalkieTalkieBar.tsx), [`speak.ts`](src/lib/client/speak.ts) |
| **Chaos Voice Compiler & 85/15 AI Routing** | Hold-to-talk `MediaRecorder` (`webm/opus → mp4 → wav`, 24 kbps) + single-pass structured extraction on `AI_FAST_MODEL` (`gemini-3.5-flash-lite`); multi-step Q&A on `AI_AGENT_MODEL` (`gemini-3.8-flash`, `thinkingLevel: LOW`, 7 read/propose tools, preserved `thought_signature`). Understands Urdu script (`نقد`), Roman Urdu, Punjabi, Saraiki, Pashto, Sindhi, Potohari, and self-corrections. | [`src/lib/audio/`](src/lib/audio), [`munshi.ts`](src/lib/ai/munshi.ts), [`agent.ts`](src/lib/ai/agent.ts) |
| **Deterministic Local NLP (`PakPhone`)** | Offline phonetic matcher (`<5 ms`, scales to **5,000+ SKUs in `<20 ms`** via inverted phonetic index, Urdu homoglyphs `ک/ك` `ی/ے`, Urdu↔Roman transliteration, aspiration/vowel drift, 125+ dialect aliases + `pg_trgm` server fallback), **Desi-Unit & Urdu Number Engine** (`adha pao` … `dhai kilo`, `darjan`, value-first), and **Price Memory**. | [`pakphone.ts`](src/lib/domain/pakphone.ts), [`desi-units.ts`](src/lib/domain/desi-units.ts), [`urdu-numbers.ts`](src/lib/domain/urdu-numbers.ts), [`PriceMemory.tsx`](src/components/PriceMemory.tsx) |
| **Tier-1 / Tier-2 Safety Gate** | Unambiguous cash sales (`≥ 0.90` confidence, verified `"cash"`/`"naqd"`/`"نقد"` evidence) auto-commit with a **5-second Undo**; *udhaar*, discounts, soft `NEGATIVE_STOCK`, ambiguity, or new SKUs open an editable review sheet with **3-Ali disambiguation chips** and **QuickAddChip** (atomic SKU creation). | [`bill.ts`](src/lib/domain/bill.ts), [`ReviewSheets.tsx`](src/components/ReviewSheets.tsx) |
| **Hash-Chained Double-Entry Ledger** | 13 Postgres migrations, strict RLS (`TO authenticated`, `(select auth.uid())`, `SECURITY DEFINER SET search_path = ''`), 4 atomic PL/pgSQL RPCs (`commit_sale`, `record_payment`, `record_purchase`, `reverse_transaction`), advisory locks, in-RPC `idempotency_keys`, deferred `SUM(ledger_entries) = 0`, trigger-maintained balances & stock, integer `bigint` paisa & base units (`g/ml/pcs`). | [`supabase/migrations/`](supabase/migrations) |
| **Crinkled Parchi OCR & Margin Shield** | **Parchi-to-Godam OCR** (`≤ 1280 px` JPEG, **zero write tools**, per-line `qty × rate` & bill `SUM` verification with `MATH_MISMATCH` Use/Keep, new-SKU detection, atomic `record_purchase`) + **Parchi Margin Guard** & **Margin Shield** (detects wholesale inflation eroding retail margins and suggests Rs. 5-rounded retail prices with 1-tap apply). | [`parchi.ts`](src/lib/ai/parchi.ts), [`ParchiSheet.tsx`](src/components/ParchiSheet.tsx), [`parchi-margin.ts`](src/lib/domain/parchi-margin.ts), [`MarginShieldSheet.tsx`](src/components/MarginShieldSheet.tsx) |
| **Aaj Ki Salah, Munshi Pulse & EOD Galla** | **Aaj Ki Salah** (`آج کی صلاح`: Friday-stockout margin-at-risk radar + 45-day dead-stock detector + 15 s Urdu audio briefing); **Munshi Pulse** (`get_munshi_pulse`, `<40 ms` pure SQL, Rs. 0 LLM); **EOD *Galla* Reconciliation** (expected vs. actual drawer count + WhatsApp summary); **Forecast & Basket Co-occurrence Insights**. | [`AajKiSalahCard.tsx`](src/components/AajKiSalahCard.tsx), [`PulseSheet.tsx`](src/components/PulseSheet.tsx), [`EodSheet.tsx`](src/components/EodSheet.tsx), [`InsightsSheet.tsx`](src/components/InsightsSheet.tsx) |
| **Khata, Wada, Mutual Khata & Recovery** | Trigger-derived balances, **Wada** (deterministic payment promise date tracking), *Wasooli*, **Mutual Khata** attestations, and polite bilingual **`wa.me` + native `sms:` (2G)** reminders. | [`KhataTab.tsx`](src/components/KhataTab.tsx), [`wada.ts`](src/lib/domain/wada.ts), [`messages.ts`](src/lib/domain/messages.ts) |
| **Bharosa Index & Ed25519 Trade Passport** | **Bharosa Index** + 30-day trade summary + head SHA-256 hash signed server-side with **Ed25519** → QR verifiable client-side in any browser at `/verify`; printable **`/report`**; **Canvas bilingual Urdu receipt PNG** (`800×1100`, Noto Sans Arabic) + Web Share; neural **Urdu TTS**. | [`passport.ts`](src/lib/crypto/passport.ts), [`src/app/verify/`](src/app/verify), [`src/app/report/`](src/app/report), [`canvas.ts`](src/lib/client/canvas.ts), [`tts.ts`](src/lib/ai/tts.ts) |
| **Offline Queue, Scalability & Mobile App** | **IndexedDB Offline Queue** (`idb-keyval` stores audio blob + original idempotency key, sequential flush with 0 dupes); **Virtualized Lists (`VirtualList`) & Server-Paginated Feed** for large shops; **App Lock**; **Zero-Config Local Demo Fallback**; **Expo SDK 58 Mobile App**. | [`queue.ts`](src/lib/client/queue.ts), [`VirtualList.tsx`](src/components/VirtualList.tsx), [`AppLock.tsx`](src/components/AppLock.tsx), [`mobile/`](mobile) |

### Production Performance & API Cost Optimizations

Designed so small Pakistani retailers remain unit-economical even at high daily transaction volume:
- **Silence-Trimmed Audio Uploads (~40–50% token reduction):** `trimSilenceChunks()` strips leading silence and the 1.2 s trailing tail before encoding `16 kHz` WAV clips, halving uploaded audio bytes and Gemini audio input tokens.
- **Verified-Final Ambient Local-First Fast-Path ($0 LLM, `<5 ms`):** When browser `SpeechRecognition` produces a finalized (`isFinal`) transcript matching `PULSE_REGEX`, `detectViewCommand`, or an unambiguous `Tier-1` cash sale (`≥ 0.90` catalog match), `store.tsx` resolves it deterministically on-device without uploading audio or calling Gemini.
- **Zero-LLM Server Fast-Paths (`route.ts`):** `PULSE_REGEX` and `detectViewCommand()` short-circuit before `loadCatalog()` and before `parseTurn()`, saving both database queries and model tokens.
- **85/15 Split & Deterministic Fallbacks:** 85% of turns run on fast `gemini-3.5-flash-lite`; `qa.ts` and `fallback-parser.ts` keep the app functional when offline or rate-limited; `5,000+` SKU matching stays `<20 ms` via an inverted phonetic index.
- **Smart TTS Caching & Watchdogs:** 200-entry server MP3 cache (60-min TTL on `msedge-tts` `ur-PK-AsadNeural`) + 80-entry client blob cache + 12 s `speechSynthesis` watchdog + clean `AbortError` suppression eliminate duplicate TTS API calls and console errors.

### System Architecture

```text
PWA (Next.js 16 App Router, Tailwind v4) / Mobile (Expo SDK 58)          Postgres (Supabase)
 ├─ Walkie-Talkie (PCM pre-roll + trimmed WAV) / Mic / Parchi
 │    ├─ verified-final Tier-1 / Pulse / Nav ──► Deterministic Local Engine (<5 ms, Rs. 0 LLM)
 │    └─ complex / audio / OCR ──► /api/munshi/turn or /api/parchi/parse ──► Gemini (mentions only)
 │                                       └─► PakPhone + desi-units + bill.ts (integer paisa)
 ├─ Tier-1 auto / Tier-2 tap ──────► /api/transactions/commit ──► commit_sale RPC ──► ledger + SHA-256 chain
 ├─ Replay / Offline Flush ────────► same idempotency_key ──► idempotency_keys ──► REPLAY_DEDUPLICATED (200)
 ├─ Pulse / Salah / Margin Shield ─► get_munshi_pulse (SQL, <40 ms) + local velocity analytics
 └─ Trade Passport ────────────────► get_trade_summary ──► Ed25519 sign ──► QR ──► /verify (client-side)
```

**Hard Invariants:**
- Money is `bigint` paisa; stock is `bigint` base units (`g`, `ml`, `pcs`) — **zero floating-point arithmetic**.
- The LLM never computes totals and never writes to the database (`0` write tools on `/api/parchi/parse`; only 7 read/propose tools on `/api/munshi/turn`).
- Clients are `SELECT`-only under RLS (`(select auth.uid())`, indexed `shop_id`, `SECURITY DEFINER SET search_path = ''`); `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser.

---

## 4. How to Run It (Step by Step)

### Prerequisites
- **Node.js** `20+` and **npm**
- *(Optional for full cloud mode)* A **Supabase** project + **Google AI Studio** `GEMINI_API_KEY`.  
  > **Zero-Config Demo Mode:** If Supabase/Gemini keys are omitted, DukaanOS automatically boots a local demo shop with deterministic rule-based parsing (`fallback-parser.ts`) and local demo state (`local-demo.ts`) so judges and developers can test immediately.

### Option A: Web PWA (Repo Root)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables
cp .env.example .env.local
# Edit .env.local to add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, and GEMINI_API_KEY (or leave blank for local demo fallback).

# 3. Generate Ed25519 signing keys, DEMO_RESET_SECRET, and stage PIN
npm run setup

# 4. Apply all 13 Postgres migrations + demo seed (14-day shop history, 3 Alis, 100+ aliases)
npm run db:apply

# 5. Start the development server (or `npm run build && npm run start` for production)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Option B: Expo Mobile App (`mobile/`)

```bash
cd mobile
npm ci
cp .env.example .env
# Set EXPO_PUBLIC_API_URL, EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_ED25519_PUBLIC_KEY
npm start          # Expo dev server (or `npm run android` / `npm run ios`)
```

### Verification & Quality Gates

```bash
npm run verify     # TypeScript (tsc --noEmit) + Vitest (35 test files, 357 tests incl. real-Postgres PGlite RPC/RLS/chain tests)
npm run eval       # 15-utterance golden evaluation (15/15 PASS on Gemini, or deterministic rules fallback)
npm run lint       # ESLint check
npm run build      # Production Next.js build
```

Canonical API error codes: `UDHAAR_REQUIRES_CUSTOMER` (400), `NEGATIVE_STOCK` (soft warning), `REPLAY_DEDUPLICATED` (200 cached), `MATH_MISMATCH` (review), `CHAIN_BROKEN` (500), `AUDIO_TOO_LARGE` (413).

---

## 5. External APIs, Libraries & AI Tools Disclosure (CYE 2026)

In full compliance with the Capital Youth Expo disclosure requirement:

### AI Coding Assistants
- **Claude** (Anthropic), **Codex** (OpenAI), and **Antigravity** (Google DeepMind) — used as AI coding assistants under the team's architecture, direction, and verification.

### Runtime AI, Speech & Cloud APIs
- **Google AI Studio / Gemini API (`@google/genai`):**
  - `AI_FAST_MODEL`: `gemini-3.5-flash-lite` (single-pass Urdu/Punjabi/English audio & text extraction + Parchi OCR)
  - `AI_AGENT_MODEL`: `gemini-3.8-flash` (multi-step Q&A with `thinkingLevel: LOW` and 7 read/propose tools)
  - `AI_TTS_MODEL`: `gemini-3.8-flash-lite-tts` (optional Urdu TTS fallback)
- **Microsoft Edge Neural Urdu TTS (`msedge-tts`):** `ur-PK-AsadNeural` neural Urdu voice synthesis.
- **Deterministic Local Fallbacks:** `fallback-parser.ts`, `qa.ts`, `local-turn.ts`, and Browser Web Speech API (`SpeechRecognition` + `speechSynthesis` `ur-PK`).
- **Supabase:** PostgreSQL database, Supabase Auth, Row Level Security (RLS), and `pg_trgm` trigram search.
- **Vercel:** Cloud hosting + daily `/api/demo/purge` cron (`vercel.json`).
- **Cloudflare Turnstile:** Bot protection on public sandbox shop creation.

### Web App Libraries (`package.json`)
- **Framework & Styling:** `next` (`16.4.6`), `react` & `react-dom` (`19.3.0`), `tailwindcss` (`4.3.3`), `@tailwindcss/turbopack` (`4.3.3`), `lucide-react` (`^1.79.0`).
- **AI, Speech, Data & Validation:** `@google/genai` (`^3.6.1`), `msedge-tts` (`^2.1.1`), `zod` (`^4.6.7`), `idb-keyval` (`^6.3.0`), `@supabase/supabase-js` (`^2.119.2`), `pg` (`^8.23.1`).
- **Cryptography & QR:** `@noble/ed25519` (`^3.2.0`), `@noble/hashes` (`^2.4.0`), `react-qr-code` (`^2.2.0`).
- **Fonts (`next/font/google`):** `Inter`, `JetBrains Mono`, `Noto Sans Arabic`, `Noto Nastaliq Urdu`.
- **Browser Web APIs:** `MediaRecorder`, Web Audio `AudioContext` / `AnalyserNode` / `ScriptProcessorNode` (PCM WAV capture), Web Speech `SpeechRecognition` & `speechSynthesis`, HTML5 Canvas, Web Crypto, Web Share API, IndexedDB.
- **Testing & Dev Tooling:** `typescript` (`^5`), `vitest` (`^5.1.1`), `@electric-sql/pglite` (`^0.6.0`), `tsx` (`^4.23.15`), `eslint` (`^9`), `eslint-config-next` (`16.4.6`), `@types/node` (`^24.19.2`), `@types/pg` (`^8.23.1`), `@types/react` (`^19`), `@types/react-dom` (`^19`).

### Mobile App Libraries (`mobile/package.json`)
- **Expo SDK 58 & React Native (`0.88.1`):** `expo`, `expo-router`, `expo-sqlite`, `expo-secure-store`, `expo-audio`, `expo-camera`, `expo-local-authentication`, `expo-print`, `expo-sharing`, `expo-haptics`, `expo-image-manipulator`, `expo-image-picker`, `expo-file-system`, `expo-crypto`, `expo-localization`, `expo-updates`, `expo-constants`, `expo-application`, `expo-font`, `expo-linking`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui`, `expo-web-browser`.
- **UI, Data, Crypto & Testing:** `@supabase/supabase-js`, `@tanstack/react-query`, `@shopify/flash-list`, `@gorhom/bottom-sheet`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets`, `react-native-safe-area-context`, `react-native-screens`, `react-native-svg`, `react-native-view-shot`, `react-native-webview`, `react-native-qrcode-svg`, `react-native-url-polyfill`, `@react-native-community/netinfo`, `lucide-react-native`, `@noble/ed25519`, `@noble/hashes`, `zod`, `@expo-google-fonts/inter`, `@expo-google-fonts/jetbrains-mono`, `@expo-google-fonts/noto-sans-arabic`, `jest`, `jest-expo`, `eslint-config-expo`, `@testing-library/react-native`.

---

## 6. 2-Minute Judge Demo Flow

1. **Hands-Free Walkie-Talkie & Disambiguation (0:00–0:35):** Toggle **Walkie-Talkie** (or tap Mic) → speak back-to-back orders including *"Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein"* → 3-Ali chips → Confirm → bilingual WhatsApp/SMS receipt.
2. **Parchi OCR & Margin Shield (0:35–1:05):** `Maal` → Scan Parchi → resolve `MATH_MISMATCH` → Restock Commit + **Margin Shield** (`منافع بچاؤ`) inflation alert & 1-tap Rs. 5-rounded retail price update.
3. **Aaj Ki Salah, Pulse & EOD Galla (1:05–1:30):** Listen to **Aaj Ki Salah** (`آج کی صلاح` Friday stockouts + 45-day dead stock) → ask *"Subah ka hisaab batao"* → **EOD *Galla* Reconciliation**.
4. **Offline Queue, X-Ray & Trade Passport (1:30–2:00):** Toggle **Simulate Offline** → commit a sale → reconnect & flush (`0 dupes`) → **`</>` X-Ray** Replay Test (`200 OK`) → **`/report`** & scan Ed25519 QR to verify client-side at **`/verify`**.

---

*Informational only — DukaanOS is not a lender, wallet, or credit bureau; the Trade Passport is not a credit score or underwriting decision.*
