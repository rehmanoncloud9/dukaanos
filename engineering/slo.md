# DukaanOS Service Level Objectives (SLOs)

| Metric | Target (p95) | Measurement |
|---|---|---|
| API Availability (`/api/app-config`, `/api/shop/state`) | 99.5% | Uptime probe + Vercel logs |
| PakPhone fuzzy matching | < 5 ms | Unit benchmark / `TurnTrace.pakphone.ms_total` |
| `get_munshi_pulse` SQL | < 40 ms | `Pulse.sql_ms` |
| `/api/shop/state` | < 400 ms | `ShopState.api_ms` |
| Voice -> proposal (`/api/munshi/turn`) | <= 2.5 s | `TurnTrace.api_ms` |
| Parchi OCR (`/api/parchi/parse`) | <= 4.0 s | Route latency |
| Offline queue flush | <= 3.0 s | Client flush timer |
| Web LCP (Fast 3G) | < 2.5 s | Lighthouse / Web Vitals |
| Mobile cold start (PKR 15K Android) | < 2.5 s | Device QA |

## Cost & Quota Guardrails (CFO)

- **COGS target**: PKR 110-180 per active shop/month.
- **Daily per-shop caps** (UTC day, env-tunable): Voice `400`, Parchi `30`, Q&A `60`, TTS `60`.
- **Global daily cap**: `AI_GLOBAL_DAILY_PKR_CAP` (default `5000` PKR/day).
- Over-cap requests return `429 RATE_LIMITED` with `retry_after`.
