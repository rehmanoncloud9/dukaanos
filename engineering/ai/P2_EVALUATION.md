# P2 — Evaluation

Date: 2026-11-24  
Task: P2 AI Intelligence Upgrade

---

## 1. Evaluation framework

The project uses two complementary evaluation mechanisms:

### 1.1 Vitest unit/integration tests (CI gate)

196 tests across 14 test files. All must pass on every commit. No API key required.

| File | Cases | What it tests |
|------|-------|---------------|
| `tests/domain/urdu-numbers.test.ts` | 77 | Number engine: digit normalisation, all fraction/scale/composed forms |
| `tests/domain.test.ts` | 50 | PakPhone, bill proposal, money, review recalculation, golden domain set |
| `tests/db.test.ts` | 22 | Hash-chain ledger, idempotency, demo reset |
| `tests/db-security.test.ts` | 6 | RLS, concurrency, export/deletion |
| `tests/domain/fallback-parser.test.ts` | 5 | Fallback intent detection and extraction |
| `tests/passport.test.ts` | 3 | Ed25519 signing/verification |
| `tests/api-auth.test.ts` | 5 | Route authentication, error hygiene |
| `tests/domain/desi-units.test.ts` | 8 | Unit lookup, pack-size requirement, quantity parsing |
| `tests/ai/munshi.test.ts` | 4 | Prompt size, Tier 1 gate, model fallback |
| `tests/ai/parchi.test.ts` | 6 | Unit guessing, missing fields, integer-paisa arithmetic |
| `tests/ai/models.test.ts` | 2 | Token usage extraction |
| `tests/ai/pricing.test.ts` | 3 | Cost estimation |
| `tests/api/ai-quota.test.ts` | 1 | Quota SQL: reserve + settle round-trip |
| `tests/api/media-validation.test.ts` | 4 | Magic-byte validation |

### 1.2 Golden utterance eval (`npm run eval:ai`)

15 natural-language utterances (cases) run against the deterministic rule
parser (no API key required). Scoring: pass/fail per case. Target: ≥ 14/15.

Command: `npm run eval:ai` (uses `--rules` flag; no Gemini API key required)

For model-path evaluation: `npm run eval:ai:voice` (requires `GEMINI_API_KEY`).

---

## 2. Golden eval cases

| # | Utterance | Gate | What is checked |
|---|-----------|------|-----------------|
| 1 | Chhote Ali ko dedh pao cheeni... | explicit_confirm | Customer, 375g cheeni, 250 value-first oil, 30 discount, 400 cash, Tier 2 |
| 2 | ek kilo cheeni cash | quick_commit_5s | 1000g cheeni, cash, Tier 1 candidate |
| 3 | pao patti cash | quick_commit_5s | 250g patti |
| 4 | dedh kilo chawal cash | quick_commit_5s | 1500g chawal |
| 5 | ek darjan anday cash | quick_commit_5s | 12 anday |
| 6 | khand 1kg cash | PakPhone | khand → cheeni 1000g |
| 7 | sarson da tail cash | PakPhone | Punjabi variant → Sarson ka Tel |
| 8 | 2 packet Lays cash | QuickAddChip | Unknown SKU → new_sku, Tier 2 |
| 9 | ek kilo atta khate mein likh do | Tier 2 | UDHAAR_REQUIRES_CUSTOMER raised |
| 10 | do kilo cheeni, 20 rupay chhor do, cash | Tier 2 | 2000 paisa discount, Tier 2 |
| 11 | 50 kilo atta cash | soft NEGATIVE_STOCK | NEGATIVE_STOCK warning |
| 12 | Bilal ne 1500 jama karwaye | explicit_confirm | intent=payment, 150000 paisa, Bilal |
| 13 | Pichli entry wapas kar do | explicit_confirm | intent=reversal |
| 14 | Subah ka hisaab batao | SQL Pulse | intent=pulse |
| 15 | Duplicate replay | PGlite | Idempotency: same transaction twice → one ledger entry |

---

## 3. Urdu number coverage (unit tests)

All cases in `tests/domain/urdu-numbers.test.ts`:

| Expression | Expected value | Test passes |
|------------|---------------|-------------|
| "adha" | 0.5 × scale | ✅ |
| "pao" | 0.25 × scale | ✅ |
| "teen pao" | 0.75 × scale | ✅ |
| "sawa" | 1.25 × scale | ✅ |
| "dedh" | 1.5 × scale | ✅ |
| "dhai" | 2.5 × scale | ✅ |
| "paune do" | 1.75 | ✅ |
| "sawa do sau" | 225 | ✅ |
| "dhai sau" | 250 | ✅ |
| "dedh hazaar" | 1500 | ✅ |
| "paune do sau" | 175 | ✅ |
| "do hazaar paanch sau" | 2500 | ✅ |
| Arabic-Indic "٢٥٠" | 250 | ✅ |
| Urdu-script "دو سو پچاس" | 250 | ✅ |
| Unrecognised input | null | ✅ |

---

## 4. Test execution results (baseline, 2026-11-24)

```
Test Files  14 passed (14)
     Tests  196 passed (196)
  Duration  28.62s
```

No failures. No skipped tests.

---

## 5. Golden eval baseline (rules-only mode)

> **Note**: The golden eval is run with `npm run eval:ai` (`--rules` flag),
> which uses the deterministic fallback parser only. This validates the number
> engine and domain logic without requiring a Gemini API key.

Expected: ≥ 14/15. The eval covers cases 1–15 as described above.

Model-path results are not available because no Gemini API key is present in
this environment. See `P2_FIELD_VALIDATION.md` for the conditions required to
run the full model evaluation.

---

## 6. Measurement limitations

| Limitation | Reason |
|------------|--------|
| No model-path eval results | No GEMINI_API_KEY in this environment |
| No real audio fixtures | No consented recordings available |
| No real parchi fixtures | No consented handwritten slips available |
| Latency numbers | Cannot be measured without live API |
| Accuracy vs. baseline | Cannot be measured without live API + baseline |

All measurements that cannot be verified are explicitly marked as unavailable
rather than estimated or extrapolated. See `P2_FIELD_VALIDATION.md` for the
plan to gather real measurements.

---

## 7. CI integration

The eval gate runs in CI as:

```yaml
- name: AI rules eval (no API key required)
  run: npm run eval:ai
```

This runs `eval-munshi.ts --rules` which exercises the deterministic rule
parser for all 15 cases. Any regression in the number engine, fallback parser,
or bill proposal immediately fails CI.
</Content>
