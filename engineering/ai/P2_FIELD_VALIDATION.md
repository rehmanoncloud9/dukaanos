# P2 — Field Validation Plan

Date: 2026-11-24  
Task: P2 AI Intelligence Upgrade

---

## 1. Status

**No consented real-world voice or parchi data was available during P2
implementation.**

All implementation, testing, and evaluation was performed against:
- Synthetic Vitest unit tests (urdu-numbers, desi-units, parchi arithmetic).
- 15 synthetic golden eval utterances in `scripts/eval-munshi.ts`.
- The deterministic rule parser (no model calls without API key).

This document describes what field validation is needed, the data requirements,
and the safety conditions for collecting it.

---

## 2. What field validation is needed

### 2.1 Voice (Munshi)

| Measurement | Method |
|-------------|--------|
| Real-world recognition accuracy | Collect consented audio → run through parseTurn → compare extracted fields to ground truth |
| Urdu number accuracy | Include utterances with `dhai`, `dedh`, `paune`, `sawa`, `hazaar`, `lakh` |
| Dialect variation | Test Punjabi-accented, Sindhi-accented, Karachi vs. Lahore pronunciations |
| Noisy environment | Counter noise (fans, coughing, background speech) |
| Fast speech | Rapid concatenated orders |
| Mixed language | Urdu + English + Punjabi in same utterance |
| Product name collisions | Similar-sounding SKUs (e.g. cheeni/chaini, patti/matti) |

Minimum useful sample size: 50–100 utterances per category.

### 2.2 Parchi (OCR)

| Measurement | Method |
|-------------|--------|
| Handwritten Urdu Nastaliq | Standard parchi format, multiple hands |
| Roman Urdu handwriting | Mixed scripts on same parchi |
| Pakistani handwritten numerals | Arabic-Indic digits, mixed with English |
| Poor lighting | Indoor counter, single bulb, 2000K |
| Camera glare | Glossy paper, direct light |
| Crumpled/folded paper | Real-world usage condition |
| Rotation > 45° | Camera held at angle |
| Multiple columns | Wholesale parchi format |
| Cross-outs and corrections | Edited entries |

Minimum useful sample size: 30–50 parchis covering the above conditions.

---

## 3. Data collection requirements

### Consent

> All audio and image data collection must follow these requirements before
> any data is used for evaluation or fine-tuning.

- Informed written consent from each contributor.
- Clear description of what data is collected and how it is used.
- Right to withdraw consent and have data deleted.
- Consent form reviewed by legal/privacy before collection begins.
- No collection from minors.
- No collection of data that identifies customers by name without their
  separate consent.

### Data handling

- Raw audio and images stored encrypted at rest.
- Not stored in this repository (`.gitignore` applies to `eval/real/`).
- Not uploaded to any external service without explicit authorization.
- Retained only for the duration of the evaluation programme.
- Annotators sign an NDA before accessing any raw samples.

### Annotation

- Ground truth annotation by two independent annotators.
- Inter-annotator agreement measured before scoring.
- Disagreements resolved by a third annotator.
- Annotation schema: JSON matching the `ParsedTurn` / `ParchiResult` shapes.

---

## 4. Evaluation metrics

### Voice

| Metric | Definition |
|--------|-----------|
| Field accuracy | Fraction of utterances where the target field (product, qty, cash, discount, customer) exactly matches ground truth |
| Tier agreement | Fraction where model Tier (1/2) matches human-assigned Tier |
| Number accuracy | Fraction of quantity/amount fields parsed to correct integer value |
| Fallback rate | Fraction of calls where model is unavailable and rule fallback is used |
| Latency P50/P99 | Measured end-to-end route latency in production |

### Parchi

| Metric | Definition |
|--------|-----------|
| Line accuracy | Fraction of lines where product+quantity+rate all match ground truth |
| Grand total accuracy | Fraction where computed grand total matches written total |
| Unit accuracy | Fraction of unit fields correctly identified |
| OCR error rate | Fraction of characters misread (requires character-level annotation) |

---

## 5. Baseline recording procedure

Before deploying P2 to production:

1. Record the existing system's accuracy on a held-out set of synthetic cases.
2. Capture baseline token usage and latency from production logs (1 week
   after quiet rollout).
3. After P2 deployment, compare the same metrics.
4. Document the difference and any unexpected regressions.

---

## 6. Parchi eval command

```bash
npm run eval:ai:parchi
# Output: "Parchi eval requires a live API key and real consented images.
#          See engineering/ai/P2_FIELD_VALIDATION.md"
```

This intentionally exits without attempting a model call, because:
- Real consented parchi images are not available.
- Running on synthetic placeholder images would produce meaningless metrics.

---

## 7. Timeline (placeholder)

| Milestone | Target |
|-----------|--------|
| Consent form drafted | TBD |
| First 20 audio samples collected | TBD |
| First 10 parchi images collected | TBD |
| Annotation completed | TBD |
| First real-world eval run | TBD |
| Production accuracy baseline | TBD |

Dates are intentionally left unset. They must be agreed with legal, privacy,
and product before collection begins.
</Content>
