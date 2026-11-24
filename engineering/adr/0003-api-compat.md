# ADR 0003: Additive-Only API Compatibility

- **Status**: Accepted
- **Date**: 2026-11-24

## Context
Once the native Android app is distributed to demo phones and Play Store internal testing, installed clients cannot be force-updated instantaneously.

## Decision
All existing `/api/*` response fields and request schemas are **additive-only**:
- Never rename or remove existing JSON keys.
- New request/response fields must be optional with safe defaults.
- Any unavoidable breaking change must be introduced under a new versioned path (`/api/v2/...`).

## Consequences
- Older mobile builds continue working seamlessly alongside newer web deployments.
- `GET /api/app-config` provides `min_supported_app_version` for controlled deprecation when needed.
