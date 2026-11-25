# P2 — Research and Decisions

Date: 2026-11-24  
Task: P2 AI Intelligence Upgrade — voice/parchi accuracy, speed, cost, Urdu numbers

---

## 1. Research scope

The following areas were investigated using primary documentation, the existing
codebase, and SDK source inspection (network-fetched docs were unavailable in
the air-gapped build environment; findings are based on SDK types, changelog,
and checked behaviour).

---

## 2. Gemini native audio understanding

**Finding**: The Google GenAI JavaScript SDK (`@google/genai ^3.6.1`) supports
inline audio as `inlineData` with MIME type and base64 content, consumed by
`generateContent`. The model processes the audio natively — no server-side
speech-to-text transcription step is involved. The model returns a structured
JSON response when `responseMimeType: "application/json"` and
`responseJsonSchema` are set.

**Decision**: Keep the existing inline audio approach. The route converts the
browser `Blob` to base64 and passes it in the `inlineData` part alongside a
text instruction. The model both transcribes and extracts fields in a single
pass.

**Rejected alternatives**:
- Whisper API — external provider, banned by directive.
- Google Cloud Speech-to-Text — separate API, banned by directive.
- Two-pass (transcribe then extract) — doubles latency and cost; native
  understanding already yields both simultaneously.

---

## 3. Structured JSON output

**Finding**: The SDK supports `responseMimeType: "application/json"` and
`responseJsonSchema` for constrained structured output. The model fills the
provided JSON schema; output that fails Zod validation triggers a fallback.

**Decision**: Use the hand-written `PARSED_TURN_JSON_SCHEMA` already in
`munshi.ts`. It includes raw number evidence fields (`quantity_phrase`,
`value_phrase`, `cash_phrase`, `discount_phrase`, `payment_amount_phrase`) in
addition to numeric values. This separates model extraction from number
interpretation, which is performed deterministically by `urdu-numbers.ts`.

**Key schema invariants**:
- `quantity_phrase` and `value_phrase` are raw spoken strings, not parsed.
- Numeric fields (e.g. `value_rupees`, `cash_paid_rupees`) are what the model
  believes, subject to overriding by deterministic verification.
- `confidence` is per-item and overall, but never used as the sole gate.

---

## 4. Image understanding and media resolution

**Finding**: The SDK accepts inline image data with JPEG, PNG, WebP, and GIF
MIME types. For parchi reading, the existing `prepareImage()` in
`src/lib/client/image.ts` rescales to 1280 px and encodes at JPEG quality 0.75
before inline upload. This is appropriate for hand-written text legibility.

**Decision**: Keep the existing image pipeline. No preprocessing step (contrast,
binarization, deskew) is introduced because:
1. Such transforms require heavyweight canvas operations on mobile that may
   degrade real images.
2. The model handles moderate noise, rotation, and varying contrast natively.
3. Preprocessing should be validated against consented real parchis before
   enabling (see `P2_FIELD_VALIDATION.md`).

---

## 5. Token usage and pricing

**Finding**: The SDK response `usageMetadata` object contains:
- `promptTokenCount` — input tokens
- `candidatesTokenCount` — output tokens
- `thoughtsTokenCount` — thinking tokens (when applicable)
- `cachedContentTokenCount` / `totalCachedTokens` — cached input tokens

Pricing (approximate, not verified against official pricing page due to network
restriction):
- Flash Lite: significantly cheaper input than Flash.
- Flash: mid-tier, used for agent Q&A.

**Decision**: The existing `estimateCostPkrMicros()` in `src/lib/ai/pricing.ts`
uses per-model per-token rates with a PKR exchange rate from env
(`AI_USD_TO_PKR_RATE`, default 280). The rates are intentionally conservative
estimates used for quota accounting only — not for billing customers. The
comment in `pricing.ts` explicitly marks them as estimates.

---

## 6. Implicit/explicit caching

**Finding**: Gemini context caching requires the content to be at least 32,768
tokens and cached content to be explicitly created via the caching API. Neither
the voice system prompt (~1,800 chars ≈ ~400 tokens) nor the parchi instruction
approaches this threshold.

**Decision**: No caching introduced. The claim that "caching saves money" on
short-prompt conversational calls is incorrect and would be misleading. Any
future caching for large catalog contexts would need measurement.

---

## 7. Browser MediaRecorder audio formats

**Finding**: MediaRecorder codec priority (from `recorder.ts`):
1. `audio/webm;codecs=opus` — preferred, ~24 kbps
2. `audio/webm` — fallback
3. `audio/mp4` — iOS Safari
4. `audio/ogg;codecs=opus` — Firefox without webm
5. `audio/wav` — baseline fallback (much larger)

**Decision**: Keep existing codec negotiation. The `media-validation.ts` magic-
byte check accepts all five formats. Minimum 600 ms, maximum 20 s prevents
accidental blank or excessively large clips.

---

## 8. Urdu number systems and conversational numeral conventions

**Research findings**:

Pakistani counter speech mixes Roman Urdu, Urdu script, and English digits.
Key number words and their values:

| Expression | Value |
|------------|-------|
| ek | 1 |
| adha / آدھا | 0.5 |
| pao / پاؤ | 0.25 |
| teen pao | 0.75 |
| sawa | 1.25 |
| dedh / deedh | 1.5 |
| dhai / ڈھائی | 2.5 |
| paune | X − 0.25 |
| sawa X | X + 0.25 |
| X sau | X × 100 |
| X hazaar | X × 1,000 |
| X lakh | X × 100,000 |
| darjan | 12 |

Composed forms: `dedh hazaar` = 1,500; `dhai sau` = 250; `paune do sau` = 175;
`sawa do hazaar` = 2,250.

Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) appear in hand-written parchis and must be
normalized to ASCII before numeric parsing.

**Decision**: Implement `src/lib/domain/urdu-numbers.ts` as a pure,
deterministic parser. It:
- Normalises Arabic-Indic and Extended Arabic-Indic digits to ASCII.
- Normalises Urdu-script number words to their Roman equivalents.
- Applies a compositional grammar: `fraction × scale + addend + extra_scale`.
- Returns `null` for unrecognised input rather than guessing.
- Provides `parseQuantityNumber`, `parseRupeeAmount`, `parseDesiNumber`, and
  `parseUrduNumberPhrase` as separate entry points with appropriate rounding.

---

## 9. Unicode normalisation

**Decision**: `normalizeUrduNumerals()` in `urdu-numbers.ts` applies a char-by-
char replacement of Arabic-Indic (U+0660–U+0669) and Extended (U+06F0–U+06F9)
to ASCII digits. No ICU or external library dependency is required.
`normalizeUrduNumberWords()` additionally lowercases and replaces Urdu-script
number words (via URDU_WORDS map) to Roman equivalents.

---

## 10. Fuzzy/phonetic matching

**Finding**: `PakPhone` in `src/lib/domain/pakphone.ts` uses a hand-tuned
phonetic transliteration for Pakistani English/Urdu names. It is deterministic
and covers common aspirated/unaspirated confusions, retroflex-dental merges, and
vowel elisions.

**Decision**: No new fuzzy library introduced. The existing PakPhone algorithm
is sufficient for catalog SKU matching. `pg_trgm` trigram similarity search
handles new-SKU candidate discovery at the database level (existing
`search_catalog` tool).

---

## 11. Quota integration

**Finding**: The existing `checkQuota` / `recordUsage` in `src/lib/server/quota.ts`
are correct but were not called from the voice and parchi routes in the original
codebase.

**Decision**: The `generateContentOnce` function in `src/lib/ai/models.ts` now
accepts an optional `billing` parameter with `shopId` and `kind`. When set:
1. `checkQuota` is called before the API request (reserves quota).
2. `recordUsage` is called after a response with actual SDK token counts.
3. If the request fails, `recordUsage` is called with the reservation upper
   bound to settle the reservation conservatively.

Both `parseTurn` (voice) and `parseParchi` (parchi) pass `shopId` from the
route's shop context.

---

## 12. Safety decisions

| Invariant | Implementation |
|-----------|---------------|
| AI never writes financial data | `write_tools_bound: 0` on parchi; no write tools in agent for parchi path |
| Parchi arithmetic is deterministic | `interpretParchiOcr()` does all qty/paisa computation; model only returns raw strings |
| Tier 1 requires explicit cash | `tier1_evidence_verified` requires payment_mode=cash + cash_phrase + zero discount + all confidences ≥ 0.9 + no unresolved numbers |
| Fallback parser can't auto-commit | `FALLBACK_CONFIDENCE = 0.8` is below Tier 1 threshold |
| Media validated before model call | `validateAudioBuffer` / `validateImageBuffer` check magic bytes |

---

## 13. Rejected approaches (documented per directive)

| Approach | Reason rejected |
|----------|----------------|
| Whisper API | Banned by directive; external provider |
| Google Cloud Speech-to-Text | Separate provider; banned by directive |
| OpenAI / Azure Speech | Banned by directive |
| Second/fallback model | Directive bans unapproved additional production models |
| Context caching | Below minimum token threshold (32k); no measured benefit |
| Image preprocessing (contrast/binarize) | Not validated against real parchis; could degrade quality |
| Heavyweight fuzzy library (fuse.js, etc.) | PakPhone + pg_trgm sufficient; added dependency cost |
| Floating-point money | Banned by directive; integer paisa throughout |
</Content>
</invoke>