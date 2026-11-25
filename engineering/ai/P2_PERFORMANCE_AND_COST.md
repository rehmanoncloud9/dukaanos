# P2 — Performance and Cost

Date: 2026-11-24  
Task: P2 AI Intelligence Upgrade

> [!IMPORTANT]
> No live Gemini API key was available during this implementation. All
> performance and cost figures below are **design targets and estimates only**.
> They are not measured values. Any improvement claim not backed by a measured
> before/after comparison is explicitly labelled as a target.

---

## 1. Latency targets

| Path | P50 target | P99 target | Basis |
|------|-----------|-----------|-------|
| Voice (audio, fast model) | < 2,000 ms | < 5,000 ms | SLO from `engineering/slo.md` |
| Voice (text typed, fast model) | < 1,500 ms | < 4,000 ms | Smaller payload |
| Voice (text typed, rules fallback) | < 10 ms | < 50 ms | Deterministic only |
| Parchi (image, fast model) | < 4,000 ms | < 8,000 ms | Vision latency higher |
| Agent Q&A (agent model) | < 6,000 ms | < 12,000 ms | Larger model |

Actual latencies depend on network, Gemini API load, and geographic routing.
They were not measured in this environment.

---

## 2. Token usage estimates

### Voice call (AI_FAST_MODEL = gemini-3.5-flash-lite)

| Component | Estimated tokens |
|-----------|-----------------|
| System prompt | ~400 input |
| Audio | Variable (audio = ~250 tokens/sec) |
| Text turn | ~100–300 input |
| Output (JSON) | ~200–400 output |

A typical 5-second audio clip: ~1,650 input tokens, ~300 output tokens.

### Parchi call (AI_FAST_MODEL = gemini-3.5-flash-lite, vision)

| Component | Estimated tokens |
|-----------|-----------------|
| System prompt | ~300 input |
| Image (1280px JPEG) | ~1,000–2,000 input (vision) |
| Output (JSON OCR) | ~300–600 output |

---

## 3. Cost estimates

> These are rough estimates based on approximate public pricing. They are used
> for quota enforcement only and must not be used for billing calculations.

| Path | Est. input tokens | Est. output tokens | Est. PKR (at Rs.280/USD) |
|------|-------------------|-------------------|--------------------------|
| Voice / turn | 1,650 | 300 | Rs. 0.03–0.06 |
| Parchi | 2,500 | 450 | Rs. 0.05–0.10 |
| Agent Q&A | 2,000 | 500 | Rs. 0.10–0.20 |

At 400 voice calls/shop/day (env default), rough daily cost per shop: **Rs. 15–25**.

The global daily PKR cap (`AI_GLOBAL_DAILY_PKR_CAP`, default 5,000) prevents
runaway spend.

---

## 4. Changes that affect performance

### Prompt token reduction

The original system prompt included the full catalog (up to 120 products, 80
customers). This was removed because:
1. Catalog matching is performed deterministically after extraction.
2. Embedding catalog in the prompt increases input token count per call.
3. It risks anchoring the model to catalog names, reducing literal transcription.

The new prompt is < 1,800 characters (~400 tokens). The old prompt with a 120-
product catalog would be ~3,000–5,000 tokens.

**Estimated token saving per voice call**: ~1,000–3,000 input tokens.

**Estimated cost reduction**: 30–60% of input token cost.

> This is a design estimate. Without measured baseline token counts it cannot
> be confirmed as a measured improvement.

### Single-pass extraction

The original code had an optional `AI_FALLBACK_MODEL` retry path. This is
removed because:
1. The directive bans unapproved additional production model routes.
2. A retry on a different model doubles latency and cost on failure paths.
3. The correct fallback for text input is the deterministic rule parser (< 10ms).

---

## 5. Quota accounting

Quota is now recorded correctly around every model call:
- Pre-call: `consume_ai_quota()` reserves the estimated cost and increments
  `calls_reserved`.
- Post-call: `record_ai_usage()` settles with actual SDK token counts.
- On failure: `record_ai_usage()` settles with the reservation upper bound.

Previously, `checkQuota` and `recordUsage` were defined but never called from
the route handlers. This meant:
- Usage was never recorded.
- Daily caps were never enforced.
- Global PKR cap was never enforced.

---

## 6. What was not measured

The following improvements cannot be quantified without a live API key,
real audio recordings, and real parchi images:

| Metric | Reason not measured |
|--------|---------------------|
| Accuracy improvement (voice) | No real audio + baseline |
| Accuracy improvement (parchi) | No real images + baseline |
| Actual latency before/after | No live API |
| Actual token counts before/after | No live API |
| Actual cost before/after | No live API |
| Cache hit rate | No caching introduced (below threshold) |

See `P2_FIELD_VALIDATION.md` for the plan to measure these in production.
</Content>
