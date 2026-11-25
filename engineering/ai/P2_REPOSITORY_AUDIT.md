# P2 AI Repository Audit

Date: 2026-11-24  
Branch: `main`  
Starting Git state: clean (`git status --short` and `git diff --stat` were empty).

## Scope and constraints

The checkout contains the project design, ADRs, security documentation, SLO, runbooks, source, migrations, tests, and CI workflow. No `AGENTS.md`, `CLAUDE.md`, or separate set of eight project-specification files is present in this checkout. The assignment text is therefore the only available P2 specification.

Official Google, MDN, and Supabase pages were requested from the supplied URLs, but both browser/search transport attempts failed. `npm ci` also failed because the sandbox could not fetch an uncached npm tarball (`ENOTCACHED`). The checkout does not have a usable `node_modules`; baseline Vitest did not start (`vitest` not recognized). These constraints prevent official-page verification and a runnable baseline in this environment. They will be tracked as verification limits, not represented as passed.

## Existing architecture and actual paths

### Voice

1. `Recorder` obtains a mono microphone stream with browser echo cancellation, noise suppression, and auto gain. It probes WebM/Opus, WebM, MP4, Ogg/Opus, then WAV, and requests 24 kbps. The recorder emits a `Blob` after a 600 ms minimum and stops at 20 seconds.
2. `DukaanProvider.submitTurn()` sends the blob to `/api/munshi/turn`; network and AI failures enqueue the original blob and key in IndexedDB. Queue flush is sequential and keeps the key.
3. The route uses `shopContext`, accepts any declared `audio/*`, checks the individual file size, loads complete shop state/catalog, and passes base64 inline data to `parseTurn`.
4. Typed pulse requests bypass Gemini. Other requests use native audio or text with `AI_FAST_MODEL`, `responseMimeType: application/json`, and a hand-written schema.
5. `parseTurn()` validates model JSON with Zod. Typed failures use `parseFallback()` at confidence 0.8; audio failures throw so the client preserves the clip.
6. The route builds a deterministic proposal with `buildSaleProposal`, matches catalog entries with PakPhone, and calls `search_catalog` with `pg_trgm` for new SKU candidates. Questions invoke the seven-function read/propose agent on `AI_AGENT_MODEL`.
7. `settle()` computes integer-paisa totals, discount, cash, credit, warnings, and tier. Tier 1 currently relies on explicit cash amount, confidence, and reasons; a verbal cash mode without a numeric cash figure can still fall through to implied cash without a reason. Matching ambiguity between two products is not independently flagged.
8. The client auto-commits Tier 1 using the existing transaction RPC and idempotency key; other sales remain editable for confirmation.

### Parchi

1. `prepareImage()` decodes to a canvas, scales to 1280 px, encodes JPEG at quality 0.75, and makes a lower-quality preview. It does not apply orientation/crop/contrast transforms or retain a full-quality original preview.
2. The route uses `shopContext`, calls `formData()`, accepts any declared `image/*`, checks file size after parsing, loads the catalog, and passes the bytes inline to Gemini vision.
3. `parseParchi()` calls the fast model with no tools, validates a small JSON shape, matches names through PakPhone, guesses units, computes line and grand totals, and returns an editable review result.
4. `ParchiSheet` defaults all line mismatches to `computed`, shows a written-vs-computed choice, and sends the chosen amounts to `/api/transactions/purchase`. The purchase RPC writes only after this explicit UI action and computes journal entries deterministically.

## Defects and root causes

### Number and language handling

- `desi-units.ts` has a separate whole-number/fraction lexicon and only token-wise quantity parsing. It cannot compose `dhai sau`, `sawa do sau`, or `do hazaar paanch sau`; fractional words can mask following scale words.
- Existing numeric quantity parsing rounds any decimal to quarters, potentially changing values finer than ¼ instead of marking them unresolved.
- Urdu-script number support is fragmented across a legacy transliterator and unit aliases. Urdu and Arabic-Indic digits are not normalized in the number parser.
- `fallback-parser.ts` amount, cash, discount, and payment patterns capture Arabic digits only. Roman Urdu number words can be quantities in limited cases but not deterministic rupee amounts.
- Missing/unrecognized quantity phrases can proceed into `resolveLine()`'s default-one behavior.

### Voice extraction and safety

- The prompt dynamically includes up to 120 products and 80 customers even though deterministic matching follows. This increases prompt size and risks anchoring the model to plausible catalog matches.
- The schema provides normalized numbers but no raw number evidence for value-first amounts, discounts, cash, or payments. Self-reported confidence is accepted as a Tier-1 signal.
- There is no deterministic post-check that compares recognized number phrases to returned numeric values, or that flags close product collisions.
- `buildSaleProposal()` can permit Tier 1 when cash is implied from a default, despite the requirement that Tier 1 represent an explicit cash sale.
- The generic optional `AI_FALLBACK_MODEL` may send production traffic to an arbitrary second model; retry classification also treats HTTP 404 as retryable.
- The question path first calls the fast model to classify/extract, then may call the agent multiple times. No explicit quota is applied to either stage.

### Parchi extraction and arithmetic

- `guessUnit()` returns pieces for all detected sizes, including `5kg`, `5L`, and `500g`.
- OCR numeric fields lack raw text evidence. Missing quantity becomes 1, missing amounts can become 0, unsupported/missing units silently default to pieces, and negative/huge values and line counts are not bounded in Zod.
- Rate and total conversion uses floating point and does not reject non-finite or unsafe paisa values.
- It computes `qty × rate` without retaining the rate's unit basis. It cannot safely interpret package/carton conversions.
- A missing written grand total is reported as passed; no required manual acknowledgment is made.
- The review UI preselects the computed amount for every mismatch, and the review choice does not govern all unresolved fields.

### Cost, latency, and security

- `checkQuota()` and `recordUsage()` exist, but voice, parchi, and agent call sites do not use them. Existing route calls therefore bypass shop caps, global caps, and usage accounting.
- `consume_ai_quota()` serializes calls per shop/kind but reads the global total before that lock and records zero estimated cost at reservation time. Concurrent new calls can all pass before completed-call costs are recorded.
- The SQL cost formula is a single rough rate (`50` PKR-micros/input token and `200`/output token), not tied to the model reported by the SDK or verified pricing. It is an estimate, not a bill.
- The SDK response's token metadata is not currently collected.
- Media routes trust declared MIME. Audio only needs an `audio/` prefix; parchi only needs `image/`. File size is checked after `formData()` has parsed the body. The proxy checks `Content-Length` only, so missing/incorrect lengths rely on the platform limit.
- `shopContext()` creates a user-scoped client; tenant RPCs are protected by user JWT/RLS. Parchi has no tools. The untrusted media text is separated from the system instruction, but prompt-injection instructions are not explicitly called out.
- `recordUsage()` currently logs a warning message on failure; the project logger itself correctly excludes raw transcript, customer data, and media.

## Existing tests and evaluation

- `tests/domain.test.ts` covers the existing Roman Urdu fallback, basic quantities, PakPhone matching, a 14-case domain golden set, money, and review recalculation.
- `tests/db.test.ts` and `tests/db-security.test.ts` exercise real migrations in PGlite, including ledger, idempotency, RLS, and the quota RPC. `tests/api-auth.test.ts` checks JWT handling. `tests/passport.test.ts` checks signatures.
- `scripts/eval-munshi.ts` has 14 parser/domain examples and one PGlite replay case. It can call Gemini when a key exists and otherwise uses the fallback parser.
- There are no AI parser/route tests, no number-engine tests, no parchi extraction or arithmetic tests, no quota route tests, no media signature tests, and no machine-readable field-level evaluation.
- The repository has no consented audio or handwritten parchi fixtures. Any new fixtures must be labelled synthetic.

## Proposed implementation architecture

1. Add a pure `urdu-numbers.ts` parser with digit normalization, Urdu-script/Roman Urdu word normalization, a strict compositional number grammar, and separate amount/quantity entry points. Return explicit `null`/unresolved results and integer-scaled money.
2. Integrate it into `desi-units.ts`, fallback amount extraction, voice structured output with raw-number evidence, and parchi normalization.
3. Keep all model output proposal-only; cap voice confidence and Tier 1 eligibility with deterministic checks for explicit cash, parseable evidence, exact product resolution, known price, and no ambiguity.
4. Tighten parchi evidence schemas, bounds, unit resolution, integer-paisa arithmetic, unknown-unit handling, and the editable review flow. Preserve raw OCR values and require a human choice for mismatches.
5. Remove unapproved arbitrary model fallback, keep the two configured Google GenAI routes, validate actual media formats, and explicitly quarantine document/audio text as untrusted evidence.
6. Integrate the existing quota RPC around each actual model call and record SDK token metadata. Keep cost accounting explicitly estimated until current official model prices and PKR conversion are verifiable; make global concurrency behavior visible and testable.
7. Add offline unit, extraction, confidence, route-security, and evaluation fixtures; retain the existing 15-case replay evaluation and add machine-readable synthetic field metrics.

## Expected measurable changes (targets, not baseline claims)

- All mandatory desi-number expressions will have deterministic unit tests, including Urdu digits and script variants.
- Unknown quantity/unit evidence will no longer be silently converted to one piece or one unit.
- Every supported parchi unit will have a base-unit conversion test; unsupported package conversions will surface for manual review.
- Every detected mismatch will require an explicit choice before commit; valid supported fixture arithmetic will be asserted exactly.
- Every production Gemini call will consume the existing quota and report input/output token usage if the SDK supplies it.
- PakPhone's existing `<5 ms` target and route latency targets remain targets only. No before/after Gemini latency or actual billing comparison is available without a runnable local toolchain, API credentials, or consented field media.

## Baseline record

- Git branch/status: `main`, clean before implementation.
- `npm ci`: failed on an unavailable npm registry object (`ws@8.23.0`, cache-only network policy).
- `npm test`: could not start because `vitest` is not installed.
- Official documentation search/open: transport failed for both direct pages and search service.
- No model calls, real audio samples, or handwritten bill samples were available for baseline evaluation.
