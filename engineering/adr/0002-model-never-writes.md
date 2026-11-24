# ADR 0002: AI Models Never Write to the Database

- **Status**: Accepted
- **Date**: 2026-11-24

## Context
LLMs can hallucinate prices, miscalculate totals, or misinterpret noisy Urdu audio. Allowing an LLM to write directly to financial tables creates unacceptable integrity risk.

## Decision
Gemini models (`AI_FAST_MODEL=gemini-3.5-flash-lite`, `AI_AGENT_MODEL=gemini-3.8-flash`) are bound **only** to read/propose tools (`0` write tools on `/api/parchi/parse`; 7 read/propose tools on `/api/munshi/turn`). All unit conversions (`desi-units.ts`), phonetic matching (`PakPhone`), and bill arithmetic run deterministically in code and Postgres RPCs. Every write requires explicit user confirmation and an `idempotency_key`.

## Consequences
- Hallucinated arithmetic cannot corrupt the ledger.
- Parchi OCR enforces `SUM(lines) == stated_total` before committing (`MATH_MISMATCH` otherwise).
