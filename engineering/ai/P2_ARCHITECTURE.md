# P2 — Architecture

Date: 2026-11-24  
Task: P2 AI Intelligence Upgrade

---

## Overview

```
Microphone ──► MediaRecorder ──► Blob ──► /api/munshi/turn
                                              │
                              validateAudioBuffer (magic bytes)
                                              │
                                        parseTurn()
                                       ╱           ╲
                               PULSE_REGEX?       generateContentOnce()
                               (regex fast path)   AI_FAST_MODEL
                                       ╲           ╱
                                     ParsedTurnZ (Zod)
                                              │
                                   normalizeModelTurn()
                                   urdu-numbers interpretation
                                   amountFromEvidence()
                                              │
                                     ◄ text fallback if error ►
                                     parseFallback() @ conf 0.8
                                              │
                                    buildSaleProposal()
                                    PakPhone matching
                                    settle() integer-paisa
                                              │
                                    Tier 1 or Tier 2 proposal
                                              │
                                    Client ReviewSheet / auto-commit
                                              │
                                       commit_sale RPC
                                       hash-chain ledger
```

---

## 1. Voice pipeline

### 1.1 Audio capture (`src/lib/audio/recorder.ts`)

- Mono microphone, echo cancellation, noise suppression, auto gain.
- Codec probe order: `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4` → `audio/ogg;codecs=opus` → `audio/wav`.
- Target bitrate: 24 kbps. Minimum duration: 600 ms. Maximum: 20 s.
- Emits a `Blob` on stop.

### 1.2 Route (`src/app/api/munshi/turn/route.ts`)

- POST, authenticated via `shopContext()`.
- File size checked on the raw blob.
- `validateAudioBuffer()` checks magic bytes (WebM 0x1A45DFA3, Ogg OggS, WAV RIFF, MP4 ftyp, MP3 ID3/FF, FLAC fLaC).
- Full shop catalog loaded from DB (products + customers).
- `parseTurn(input)` called with inline audio base64 or typed text.
- `buildSaleProposal()` assembles a deterministic proposal from the parsed turn.
- Quota checked and recorded inside `generateContentOnce` (via `billing.shopId`).

### 1.3 Extraction (`src/lib/ai/munshi.ts`)

**Fast paths** (no model call):
- Empty input → rejected upstream.
- Text-only pulse pattern (PULSE_REGEX) → returns `pulseTurn()` immediately.

**Model path**:
1. Builds `parts` array: audio inline data (if present) + text instruction.
2. Calls `generateContentOnce` with `AI_FAST_MODEL`, JSON schema, temperature 0.
3. Validates response with Zod `ParsedTurnZ`.
4. `normalizeModelTurn()`:
   - Calls `parseQuantityNumber()` on each `quantity_phrase` → deterministic `qty_base_units`.
   - Calls `amountFromEvidence()`: verifies `value_phrase` / `cash_phrase` / `discount_phrase` / `payment_amount_phrase` by parsing with `parseRupeeAmount()` and comparing to model's numeric value. Sets `number_unresolved` when mismatch or parse failure.
   - Sets `tier1_evidence_verified` only when: `payment_mode === "cash"` AND `cash_phrase` exists AND `discount_paisa === 0` AND all item confidences ≥ 0.9 AND overall confidence ≥ 0.9 AND no unresolved numbers.
5. Returns `TurnParse` with `source: "model"`.

**Text fallback** (model error):
- If `text` is non-empty and model throws, `parseFallback()` runs at `FALLBACK_CONFIDENCE = 0.8`.
- Fallback result always has `tier1_evidence_verified: false`.
- Returns `TurnParse` with `source: "rules"` and `degraded_reason`.

**Regex fallback** (audio error):
- If audio fails (no text), error is re-thrown so the client can preserve the clip in IndexedDB.

### 1.4 Number engine (`src/lib/domain/urdu-numbers.ts`)

Pure deterministic module. No external dependencies.

**Normalisation**:
- `normalizeUrduNumerals(s)`: replaces Arabic-Indic (٠–٩, U+0660) and Extended (۰–۹, U+06F0) to ASCII digits.
- `normalizeUrduNumberWords(s)`: lowercases + replaces Urdu-script number words to Roman Urdu equivalents (via `URDU_WORDS` map).

**Grammar** (`parseDesiNumber`):
```
value = fraction | integer_or_decimal
fraction = "adha" (0.5) | "pao" (0.25) | "teen_pao" (0.75) |
           "paune X" (X − 0.25) | "sawa X" (X + 0.25) | "dedh" (1.5) | "dhai" (2.5)
scale = "sau" (×100) | "hazaar" (×1000) | "lakh" (×100000)
composed = value [scale] [addend] [scale]
```

Returns exact hundredths as an integer (e.g. `dhai` → 250, representing 2.50).
Returns `null` for unrecognised input.

**Entry points**:
- `parseDesiNumber(s)` → `{hundredths: number} | null`
- `parseQuantityNumber(s, baseUnit)` → `{qty_base_units: number, qty_display: string} | null`
- `parseRupeeAmount(s)` → `{rupees: number, paisa: number} | null`
- `parseUrduNumberPhrase(s)` → plain number (fractional, may be non-integer)

### 1.5 Unit engine (`src/lib/domain/desi-units.ts`)

- `lookupUnit(token)` → `BaseUnit | null` for supported units (g, kg, L, mL, pcs, darjan, etc.).
- `parseQuantityPhrase(phrase)` → `{qty_base_units, unit, unresolved}`.
  - `unresolved: true` when quantity word exists but unit is unknown or missing.
- `requiresExplicitPackSize(unit)` → true for carton, bag, box etc. (requires human to supply base units).
- `guessParchiUnit(raw)` → for parchi OCR lines, extracts `NUMunit` patterns (e.g. `5kg`, `500g`, `2L`) correctly as mass/volume.

### 1.6 Proposal and settlement (`src/lib/domain/bill.ts`)

- `buildSaleProposal()`: matches spoken product names with PakPhone, resolves catalog lines, computes integer-paisa totals.
- `settle()`: applies discount, credit, cash. All arithmetic is integer paisa. No floating point.
- Tier 1 requires: `tier1_evidence_verified`, no UDHAAR, no ambiguous customer, no new SKU, no negative stock.

---

## 2. Parchi pipeline

```
Camera/Gallery ──► prepareImage() ──► JPEG 1280px ──► /api/parchi/parse
                                                            │
                                             validateImageBuffer() (magic bytes)
                                                            │
                                                      parseParchi()
                                                            │
                                                   generateContentOnce()
                                                    AI_FAST_MODEL, vision
                                                            │
                                                  ParchiOcrZ (Zod, evidence-only)
                                                            │
                                                 interpretParchiOcr()
                                                 deterministic arithmetic
                                                 PakPhone product matching
                                                 guessParchiUnit()
                                                 integer-paisa computation
                                                            │
                                                     ParchiSheet UI
                                                     editable review
                                                            │
                                                  /api/transactions/purchase
                                                  purchase RPC, hash-chain
```

### 2.1 Image preparation (`src/lib/client/image.ts`)

- Decodes image to canvas, scales longest edge to ≤ 1280 px.
- Encodes JPEG quality 0.75 for model upload.
- Generates a lower-quality preview for the UI.

### 2.2 Route (`src/app/api/parchi/parse/route.ts`)

- POST, authenticated.
- `validateImageBuffer()` checks magic bytes (JPEG FFD8, PNG 89504E47, WebP RIFF...WEBP).
- Size limit enforced post-parse.
- Shop catalog loaded.
- `parseParchi(input)` called.
- Returns editable `ParchiResult`.

### 2.3 Extraction (`src/lib/ai/parchi.ts`)

- Calls `generateContentOnce` with `AI_FAST_MODEL` (vision), JSON schema, `write_tools_bound: 0` enforced.
- OCR schema is **evidence-only**: all fields are raw strings (`quantity_raw`, `unit_raw`, `rate_raw`, `line_total_raw`, `grand_total_raw`).
- `interpretParchiOcr()` does all arithmetic deterministically:
  - `normalizeUrduNumerals()` on all raw strings.
  - `parseRupeeAmount()` to convert to integer paisa.
  - `guessParchiUnit()` to convert unit strings.
  - qty × rate computed in integer paisa.
  - Grand total compared to computed sum; mismatch flagged.
- Returns `ParchiResult` with `written_grand_total_paisa` and `computed_grand_total_paisa`.

### 2.4 Review UI (`src/components/ParchiSheet.tsx`)

- Shows line-by-line editable fields.
- Written vs computed total choice required when they differ.
- No auto-commit path exists for parchi (always explicit confirm).

---

## 3. Quota system

### Architecture

```
Route ──► parseTurn / parseParchi
              │
              ▼
         generateContentOnce(model, params, timeoutMs, billing)
              │
              ├─► checkQuota(shopId, kind, model)
              │     ├─ consume_ai_quota() SQL (atomic, per-shop serialized)
              │     └─ returns TokenReservation (reserved_cost, quota check)
              │
              ├─► genai().models.generateContent(...)   ← actual API call
              │
              └─► recordUsage(shopId, kind, usage, reservation, model, cost, source)
                    └─ record_ai_usage() SQL (settles reservation, records tokens)
```

### SQL functions (migration `20261125105_ai_quota_accounting.sql`)

- `consume_ai_quota(shop_id, kind, model, now, daily_cap, reserved_cost, global_pkr_cap)`:
  - Row-level lock per shop/kind/date.
  - Checks daily call count and global cost cap.
  - Increments `calls_reserved` and `cost_reserved_micros`.
  - Returns quota check result and reservation ID.

- `record_ai_usage(shop_id, kind, in_tokens, out_tokens, cached_tokens, model, est_cost_micros, reservation_id, latency_ms, source)`:
  - Upserts into `ai_usage`, settles reservation.
  - `est_cost_micros` tracked separately from `cost_reserved_micros`.

### Cost estimation

`estimateCostPkrMicros(model, usage, usdToPkr)` in `src/lib/ai/pricing.ts`:
- Uses per-model per-token rates (documented as estimates, not official billing).
- PKR conversion from `AI_USD_TO_PKR_RATE` env (default 280).
- Used for quota accounting only, not customer billing.

---

## 4. AI safety boundaries

| Boundary | Enforcement |
|----------|-------------|
| AI never writes financial data | No write tools in parchi (`write_tools_bound: 0`); agent tools are read/propose only |
| Parchi arithmetic is always deterministic | `interpretParchiOcr()` owns all quantity/paisa computation |
| Model output treated as untrusted | Zod validation on all model JSON; raw strings not exec'd |
| Prompt injection quarantine | Document/audio text is in `user` part, not `systemInstruction` |
| Media validated before model | Magic-byte check rejects invalid formats |
| Tier 1 requires deterministic evidence | `amountFromEvidence()` verifies model numbers against parsed phrases |
| Fallback parser can't auto-commit | Hardcoded `FALLBACK_CONFIDENCE = 0.8` ceiling |

---

## 5. Data flow invariants

- All money is integer paisa throughout. No floating-point storage.
- All quantities are integer base units (grams, mL, pieces).
- Urdu number interpretation is performed by `urdu-numbers.ts`, not by the model.
- Model returns evidence (raw phrases); deterministic code converts to values.
- Hash-chain ledger is never modified by AI code paths.
- Idempotency keys are generated by the client, not the AI.
</Content>
