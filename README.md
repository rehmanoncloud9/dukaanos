# DukaanOS — Pakistan's Zero-Literacy Financial Compiler

**Capital Youth Expo 2026 · Technology Hackathon (04-HK) · Track 3 — FinTech & Financial Inclusion**

DukaanOS compiles chaotic, code-switched Urdu / Punjabi / English counter speech and crinkled handwritten wholesale parchis into **SHA-256 hash-chained, double-entry Postgres ledgers**, proactive cash-flow alerts (Munshi Pulse) and an **Ed25519 QR-verifiable SBP SMEConnect Trade Passport** — without ever letting an LLM write to the books or do arithmetic.

> *Sirf Aap Ka Record — Zero FBR Linkage.* Private udhaar recovery. No CNIC, no tax fields, owner-consented exports only.

Design system: [`DESIGN.md`](DESIGN.md)

---

## What ships (F-01 → F-12, all built)

| ID | Feature | Where |
|---|---|---|
| F-01 | **Chaos Voice Compiler** — hold-to-talk MediaRecorder (MIME probing webm/opus → mp4 → wav, 24 kbps, 3–20 s), single-pass audio→JSON on `AI_FAST_MODEL`; multi-step Q&A on `AI_AGENT_MODEL` (`thinkingLevel: LOW`, 7 read/propose tools, thought signatures preserved, zero prefilled turns) | `src/lib/audio`, `src/lib/ai/munshi.ts`, `src/lib/ai/agent.ts`, `/api/munshi/turn` |
| F-02 | **PakPhone** offline phonetic matcher (<5 ms, Urdu homoglyphs ک/ك ی/ے, Urdu↔Roman transliteration, aspiration/vowel drift, Levenshtein) + **desi-unit** engine (adha pao … dhai kilo, darjan, value-first) + **125 dialect aliases** with a `pg_trgm` server fallback | `src/lib/domain/pakphone.ts`, `desi-units.ts`, `search_catalog` RPC |
| F-03 | **Tier-1 / Tier-2 safety gate** — cash ≥0.90 auto-commits with a 5 s Undo; udhaar/discount/ambiguity/new SKU → editable review card, 3-Ali chips, QuickAddChip (atomic SKU creation) | `src/lib/domain/bill.ts`, `ReviewSheets.tsx` |
| F-04 | **Hash-chained RPC core** — 11 tables, RLS, 4 atomic PL/pgSQL RPCs (`commit_sale`, `record_payment`, `record_purchase`, `reverse_transaction`), advisory locks, in-RPC idempotency, deferred `SUM(ledger)=0`, trigger-maintained balances & stock, append-only guards | `supabase/migrations` |
| F-05 | **`</>` X-Ray** — transcript + model + latency, PakPhone score + desi formula, balanced journal (Δ = 0), SHA-256 + RLS shop_id, hash recompute, **Replay Test** → `200 OK · 0 Dupes`, Simulate Offline, chain verifier | `XRaySheet.tsx` |
| F-06 | **Munshi Pulse** — pure SQL (`get_munshi_pulse`, Rs. 0 LLM): 15+ day FIFO-aged udhaar, 7-day stockout velocity (≤2.5 days), today's galla & margin; regex fast path for "Subah ka hisaab batao" | `PulseSheet.tsx` |
| F-07 | **Crinkled Parchi OCR** — ≤1280 px JPEG, **zero write tools**, per-line `qty × rate` and bill `SUM` checks (`MATH_MISMATCH` Use/Keep), new-SKU detection, staged field sample, `record_purchase` restock | `src/lib/ai/parchi.ts`, `ParchiSheet.tsx` |
| F-08 | **Khata & dual reminders** — trigger-derived balances, Wasooli, polite bilingual `wa.me` + native `sms:` (2G) links | `KhataTab.tsx`, `messages.ts` |
| F-09 | **Offline IndexedDB queue** (idb-keyval) — audio blob + idempotency key, Pending Sync pill, sequential flush on reconnect with the original key (0 dupes) | `src/lib/client/queue.ts` |
| F-10 | **Ed25519 SMEConnect Trade Passport** — 30-day summary + head SHA-256 hash signed server-side, QR → public `/verify` checks the signature in the judge's browser | `src/lib/crypto/passport.ts`, `/verify` |
| F-11 | **Canvas bilingual Urdu receipt PNG** (800×1100, Noto Sans Arabic) + Web Share | `src/lib/client/canvas.ts` |
| F-12 | **Full SMEConnect report** (print / Save PDF) + **query-only Urdu TTS** (`AI_TTS_MODEL`, browser `speechSynthesis` fallback) | `/report`, `src/lib/ai/tts.ts` |

**Additions (improvised, nothing removed):** live chain verifier + **Tamper Test** (silently edits a ledger row in a demo shop; the chain catches it), per-judge isolated sandbox shops, rule-based parser so typed input survives a model outage (always Tier-2), `/api/system/health` Dec-1 cutover audit, real-audio replay library (2 s logo long-press), customer/product editors, COGS + margin postings.

## Architecture

```
PWA (Next.js 16 App Router, Tailwind v4, lucide)            Postgres (Supabase)
 ├─ mic / typed / parchi  ──► /api/munshi/turn ──► Gemini (mentions only, JSON schema)
 │                                 └─► PakPhone + desi-units + bill.ts (integer paisa)
 ├─ Tier-1 auto / Tier-2 tap ─► /api/transactions/commit ─► commit_sale RPC ─► ledger + SHA-256 chain
 ├─ X-Ray / Replay ──────────► same key ─► idempotency_keys ─► REPLAY_DEDUPLICATED
 ├─ Pulse ───────────────────► get_munshi_pulse (SQL, <40 ms)
 └─ Passport ────────────────► get_trade_summary ─► Ed25519 sign ─► QR ─► /verify (client-side)
```

Invariants: money is `bigint` paisa, stock is `bigint` base units (g/ml/pcs), no floats; the LLM never computes totals and never touches the DB; clients are SELECT-only under RLS (`is_shop_member`, `(select auth.uid())`, `search_path=''`); the service-role key never reaches the browser.

## Run it

```bash
npm install
cp .env.example .env.local        # add Supabase URL/anon/service keys, DATABASE_URL, GEMINI_API_KEY
npm run setup                     # generates Ed25519 keys, DEMO_RESET_SECRET, stage PIN
npm run db:apply                  # 3 migrations + seed (stage shop with 14-day history)
npm run setup                     # again: creates stage@dukaanos.pk and links it to the stage shop
npm run dev
```

## Quality gates

```bash
npm run verify    # tsc --noEmit + vitest: 50 domain tests + 22 real-Postgres (PGlite) RPC/RLS/chain tests
npm run eval      # 15-utterance golden eval (target ≥14/15) — Gemini if keyed, else rule parser
```

Canonical error codes: `UDHAAR_REQUIRES_CUSTOMER` (400), `NEGATIVE_STOCK` (soft), `REPLAY_DEDUPLICATED` (200 cached), `MATH_MISMATCH` (review), `CHAIN_BROKEN` (500), `AUDIO_TOO_LARGE` (413).

## Demo (4:45)

1. **Act 1** — "Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein" → 3-Ali chips → Confirm → WhatsApp receipt.
2. **Act 2** — Maal → Scan Parchi (or 1-tap staged sample) → fix the `MATH_MISMATCH` → Restock Commit.
3. **Act 3** — Wi-Fi OFF (or Simulate Offline) → speak a sale → Pending Sync → Wi-Fi ON → flush → `</>` X-Ray → Replay Test.
4. **Act 4** — "Subah ka hisaab batao" → Pulse → Khata → SMEConnect → judges scan the QR → `/verify`.

## Stack

Runtime AI is **Google Gemini** (`gemini-3.5-flash-lite` for 85% audio/parchi traffic, `gemini-3.8-flash` for 15% Q&A, TTS model for read-outs). Platform: **Supabase** (Postgres, Auth, RLS, `pg_trgm`), **Next.js 16 / React 19 / Tailwind CSS v4**, **idb-keyval**, `@noble/ed25519`, `react-qr-code`, `lucide-react`, `zod`, Vitest + PGlite. Fonts: Inter, JetBrains Mono, Noto Sans Arabic, Noto Nastaliq Urdu.

*Informational only — DukaanOS is not a lender, wallet or credit bureau; the Trade Passport is not a credit score or underwriting decision.*
