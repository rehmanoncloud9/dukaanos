# DukaanOS Mobile Core Contract (`mobile/src/core/`)

H+3 hand-off contract for **P5** (`khata`, `maal`, `parchi`, `passport`, `settings`).
Do not edit `mobile/src/core/**` from P5 PRs — request changes from P4 if a new endpoint wrapper or token is needed.

## Shared Code Aliases (Read-Only)
- `@domain/*` -> `../src/lib/domain/*` (PakPhone, desi-units, bill/tier gate, money, messages)
- `@contracts` -> `../src/lib/api/contracts.ts`
- `@passport` -> `../src/lib/crypto/passport.ts` (Hermes `sha512` + `crypto.getRandomValues` polyfilled at startup via `@/core/crypto-polyfill`)

## Modules Exported for P5

### 1. Auth & Config
- `useSession()` (`@/core/auth/SessionProvider`): `{ configured, ready, session, user, signInSandbox, signInPassword, signInMagicLink, signOut }`
- `configStatus` / `requireMobileConfig()` (`@/core/config`): Zod-validated `apiUrl`, `supabaseUrl`, `supabaseAnonKey`, `ed25519PublicKey`.

### 2. API Client (`@/core/api/client`)
- `apiClient`: single fetch client injecting `Authorization: Bearer`, `x-shop-id`, `x-client: dukaanos-mobile/<version> (<platform>)`, 45s/60s timeouts, one 401 refresh retry, offline guard, typed `ApiError`.
- Endpoints for P5:
  - Khata: `addCustomer`, `updateCustomer`, `updateCustomerCreditLimit`, `customerLedger`, `payment`
  - Maal / Parchi: `parchiParse(fileUri, mimeType)`, `purchase`, `updatePrice`, `addAlias`
  - Passport: `tradeSummary(days)`
  - Settings: `chain`, `demoReset`, `demoTamper`, `health`, `accountExport`, `accountDelete`
- `friendlyApiError(err)`: bilingual Roman Urdu/English copy for canonical error codes.
- `newIdempotencyKey(prefix)`: UUID v4 idempotency keys via `expo-crypto`.

### 3. State & Queries (`@/core/state/ShopProvider`)
- `useShop()`: `{ shops, shopId, shop, setShopId, reloadShops, createShop, xrayOn, setXrayOn, lastCommit, recordCommit, undo, setUndo, invalidateShop }`
- `useShopState()`: TanStack Query + SQLite offline snapshot fallback (`{ data, isStaleCache, cachedAt, refetch, isLoading }`)
- `usePulse()`: 15+ day overdue udhaar & 2-day stockout velocity
- `useFeed(limit)` / `useCustomerLedger(customerId, limit)`: infinite pagination hooks

### 4. Offline Queue (`@/core/offline/OfflineProvider`)
- `useOffline()`: `{ online, simulatedOffline, setSimulatedOffline, pending, queue, reviewInbox, enqueueTurn, dequeueTurn, retryTurn, flush }`
- Backed by `expo-sqlite` (`dukaanos.db` -> `pending_turns`, `shop_state_cache`, `kv_store`, `replay_clips`) and `expo-file-system` (`Paths.document/queue/`).

### 5. Theme & UI Kit (`@/core/theme/tokens`, `@/core/theme/fonts`, `@/core/ui`)
- Tokens: `colors`, `radii`, `spacing`, `typography`, `ICON_STROKE` (`1.75`), `MIN_TARGET_DP` (`48`)
- Fonts: `fontFamilies` (`Inter`, `JetBrains Mono`, `Noto Sans Arabic`)
- Components: `Screen`, `Header`, `Card`, `Money`, `Pill`, `Segmented`, `PrimaryButton`, `SecondaryButton`, `IconButton`, `Sheet`, `ToastProvider`, `useToast`, `Skeleton`, `EmptyState`, `relTime`, `shortDate`

### 6. i18n, Security & Feature Flags
- `useT()` (`@/core/i18n/I18nProvider`): `{ lang, setLang, t, isUrdu }`
- `useAppLock()` (`@/core/security/AppLockGate`): `{ enabled, setEnabled, locked, unlock }` (2-minute background biometric/PIN lock)
- `useAppConfig()` / `useFeature(name)` (`@/core/version/VersionProvider`)

## Placeholder Routes Owned by P5
Replace these route files directly under `mobile/src/app/`:
- `(tabs)/khata.tsx`
- `(tabs)/maal.tsx`
- `passport.tsx`
- `settings.tsx`
- `parchi.tsx`
