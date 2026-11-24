# DukaanOS — Apple HIG Design System & UI Specification (`DESIGN.md`)

> Single source of truth for every screen (web PWA and mobile app): exact pixel fidelity, zero visual clutter, and 100% daylight + projector legibility.

---

## 1. Visual North Star & Non-Negotiable Anti-Slop Rules

DukaanOS follows **Apple HIG precision** (inspired by Apple Wallet, Apple Health, and Things 3) calibrated for **both** PKR 11,000–18,000 Android 400-nit LCD screens under harsh shop tube lights **and** 20-foot auditorium projectors at Pak-China Friendship Center.

### Strictly Banned (visual clutter)
1. **Zero purple/indigo/cyan gradients or neon glow shadows** — use one disciplined daylight financial palette (`#F2F2F7` canvas, `#FFFFFF` cards, `#0A0A0A` ink, restrained semantic accents).
2. **Zero sparkle icons (`✨`), "AI-Powered" badges, or chat-bubble threads** — voice parses directly into editable ledger rows, bottom sheets, or a compact 5-second Undo toast.
3. **Zero glassmorphism soup** — every ledger, Khata, and Maal card is **100% opaque `#FFFFFF`**. Reserve `backdrop-filter: blur(20px)` strictly for the sticky header and 3-tab bottom bar.
4. **Zero `animate-ping` radar rings or fake waveforms** — use a real 5-bar Web Audio `AnalyserNode` meter (`3px` bars, `6px` idle to `26px` peak).
5. **Zero emoji chrome or mixed icon weights** — use `lucide-react` exclusively at `strokeWidth={1.75}`.
6. **Zero drop-shadow soup or 4-up cramped KPI grids** — use flat inset cards with `1px` (`0.5px` Retina) borders (`rgba(0,0,0,0.08)`) and a clean 2-column pulse strip.

---

## 2. Copy-Paste Tailwind v4 Design Tokens (`src/app/globals.css`)

```css
@import "tailwindcss";

@theme {
  /* Daylight Financial Surfaces & High-Contrast Ink */
  --color-canvas: #F2F2F7;          /* iOS grouped background */
  --color-surface: #FFFFFF;         /* 100% opaque elevated cards */
  --color-surface-sunken: #EBEBEF;  /* Segmented control & subtle wells */
  --color-ink: #0A0A0A;             /* 19.8:1 primary ink */
  --color-ink-2: #52525B;           /* 7.4:1 secondary ink (bans text-gray-400) */
  --color-ink-3: #71717A;           /* Tertiary captions / inactive icons */

  /* Strictly Restrained Semantic Accents */
  --color-cash: #047857;            /* Cash / Verified / Settled */
  --color-cash-bg: #DCFCE7;         /* High-contrast status pill fill */
  --color-cash-ink: #14532D;        /* Status pill text */

  --color-udhaar: #C2410C;          /* Udhaar / Overdue / MATH_MISMATCH */
  --color-udhaar-bg: #FEE2E2;       /* High-contrast alert pill fill */
  --color-udhaar-ink: #991B1B;      /* Alert pill text */

  --color-maal: #0F766E;            /* Maal / Inventory / Parchi Scan */
  --color-maal-bg: #F0FDFA;         /* New Item / Stock pill fill */

  /* Apple Wallet Pass Surface (Screen 6 Only) */
  --color-pass-bg: #0F172A;
  --color-pass-elevated: #1E293B;
  --color-pass-emerald: #10B981;
  --color-pass-ink: #F8FAFC;
  --color-pass-muted: #94A3B8;

  /* Hairlines & Concentric Radii */
  --color-border-card: rgba(0, 0, 0, 0.08);
  --color-border-hairline: rgba(0, 0, 0, 0.06);
  --radius-card: 16px;
  --radius-sheet: 24px;
  --radius-pass: 20px;
  --radius-cta: 14px;
  --radius-chip: 12px;

  /* Typography */
  --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
  --font-urdu-ui: "Noto Sans Arabic", sans-serif;
  --font-urdu-read: "Noto Nastaliq Urdu", serif;

  /* Motion */
  --ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
  --ease-tactile: cubic-bezier(0.2, 0, 0, 1);
}

.num {
  font-variant-numeric: tabular-nums lining-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
}

.rs-prefix {
  font-size: 0.62em;
  font-weight: 500;
  opacity: 0.58;
  margin-right: 3px;
}

.hairline-b { border-bottom: 1px solid var(--color-border-hairline); }
@media (min-resolution: 2dppx) { .hairline-b { border-bottom-width: 0.5px; } }

.section-label {
  font-size: 11px;
  line-height: 14px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-ink-2);
}

.surface-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border-card);
  border-radius: var(--radius-card);
}

.tactile {
  transition: transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 120ms ease;
  touch-action: manipulation;
}
.tactile:active { transform: scale(0.97); }
```

---

## 3. Typography & Bilingual Urdu Discipline

| Role | Font & Weight | Size / Line-Height | Tracking | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Hero PKR Total** | Inter Bold (700) | `34px / 38px` | `-0.03em` | Khata Total Receivable (`tabular-nums`) |
| **Pulse Metric** | Inter Bold (700) | `22px / 26px` | `-0.02em` | Today Cash / Today Udhaar (`tabular-nums`) |
| **Screen / Sheet Title** | Inter Bold/SemiBold | `20px` (tab) / `17px` (sheet) | `-0.02em` | Sticky header & bottom-sheet headers |
| **Ledger Row Title** | Inter Medium (500) | `15px / 20px` | `0` | Customer/item names (hard `15px` floor) |
| **Secondary Metadata** | Inter Regular (400) | `12.5px–13px / 18px` | `0` | Timestamps, unit prices (`#52525B`, 7.4:1) |
| **Section Eyebrow** | Inter SemiBold (600) | `11px / 14px` | `+0.06em` | Uppercase group headers (`TODAY · 24 NOV`) |
| **X-Ray / Hash Mono** | JetBrains Mono (500/600) | `11px–11.5px / 16px` | `0` | Strictly inside `</> X-Ray` & SHA-256/QR |
| **Urdu UI Labels** | Noto Sans Arabic (600) | `15px / 1.75` | `0` | Compact Urdu tags (`padding-block: 3px`, `dir="auto"`) |
| **Urdu Spoken Readout** | Noto Nastaliq Urdu | `16px / 2.15` | `0` | Transcript/receipts (`overflow: visible`) |

---

## 4. Complete Assets, Fonts, Icons & Vector Graphics Inventory

DukaanOS requires **ZERO external raster photos, ZERO stock illustrations, and ZERO Figma exports**—every visual element is pure CSS, Google Fonts, `lucide-react` vector icons, or crisp inline SVG so the PWA stays under ~3 MB and loads instantly on 3G.

### Fonts (Load via `next/font/google` or local `/public/fonts/`)
- `Inter` (weights `400, 500, 600, 700`) — primary UI & tabular PKR numerals.
- `JetBrains Mono` (weights `400, 500, 600`) — `</> X-Ray` inspector & SHA-256 hashes.
- `Noto Sans Arabic` (weight `600`, bundle locally in `public/fonts/NotoSansArabic-Bold.ttf` if P1 Canvas receipt is enabled) — crisp, non-clipping Urdu UI labels.

### Icon Pack (`lucide-react` — Locked to `strokeWidth={1.75}`)
| Icon Name (`lucide-react`) | Size | Color Token | Where Used |
| :--- | :--- | :--- | :--- |
| `Lock` | `11px` | `#52525B` | `Zero FBR` privacy pill in Munshi header |
| `Mic` | `24px` (dock) / `20px` (tab) | `#FFFFFF` / `#0A0A0A` | 66px Hold-to-Talk FAB & Tab 1 nav |
| `Camera` | `16px` | `#0F766E` / `#FFFFFF` | Parchi quick pill & Maal `+ Scan Parchi` CTA |
| `BookOpen` | `20px` | `#0A0A0A` / `#71717A` | Tab 2 (`Khata`) bottom navigation |
| `Package` | `20px` | `#0A0A0A` / `#71717A` | Tab 3 (`Maal`) bottom navigation |
| `ChevronDown` | `16px` | `#52525B` | Collapsible `Munshi Pulse` strip |
| `QrCode` | `14px` | `#FFFFFF` | `SMEConnect` pill in Khata header |
| `RotateCcw` | `15px` | `#0A0A0A` | `Replay Test` button inside `</> X-Ray` |
| `AlertCircle` | `16px` | `#991B1B` | Non-blocking negative-stock banner in Maal |
| `Check` / `X` | `14px` | `#14532D` / `#52525B` | Selected Ali chip, verified states, sheet close |

### Custom Vector / Canvas Graphics (Inline — Zero External Assets)
1. **5-Bar Real-Time Voice Amplitude Meter**: 5 `<span class="eq-bar">` elements (`width: 3px`, `gap: 3px`, `border-radius: 9999px`) driven by Web Audio `AnalyserNode` (`height: 6px` to `26px`, `transition: height 80ms linear`).
2. **Ed25519 Signed QR Code**: Rendered as crisp inline SVG (`qrcode` npm package or `react-qr-code`, `#0F172A` modules on `#FFFFFF`, ECC Level `M`, `144×144px` inside `#1E293B` well).
3. **4px Stock Progress Bars**: Pure CSS `div` (`height: 4px`, `rounded-full`, `#0F766E` healthy -> `#C2410C` when `<= 25%`).

---

## 5. Exact Component Specs for All 6 Main Screens

### Screen 1: `Munshi` (Tab 1 — Voice Counter Home)
- **App Shell**: `max-w-[430px] mx-auto min-h-dvh bg-canvas px-4 pb-[148px]`.
- **Sticky Header (`48px`)**: Left `Bismillah Kiryana` (`20px Bold`) + `Zero FBR` lock pill; Right `</> X-Ray` pill (`h-7 px-2.5 rounded-full bg-white border border-black/15`).
- **Offline Banner**: Hidden when online; amber `#FEF3C7` strip showing `Offline · N Pending Sync (IndexedDB)` + `Reconnect` button.
- **2-Column Pulse (`grid-cols-2 gap-2.5`)**: Opaque white cards (`p-3.5`) for `TODAY CASH` (`#047857` dot, `#0A0A0A` figure) and `TODAY UDHAAR` (`#C2410C` dot & figure).
- **Collapsible `Munshi Pulse` Strip**: Single `40px` row (`3 overdue · Rs. 8,400 · 2 low stock`); expands into 2 action rows routing to `Khata?filter=overdue` and `Maal?filter=low`.
- **Chronological Feed**: Grouped inset card with `60px` rows separated by `0.5px` inset hairlines. Tapping any row opens `</> X-Ray`.
- **Tier-1 5s Undo Toast**: `bg-[#0A0A0A] text-white h-11 rounded-xl` with `#34D399` `Undo` CTA and `2px` linear `scaleX(1 -> 0)` 5-second countdown bar.
- **Floating Dock (`bottom: 68px`)**: Centered `66×66px` Hold-to-Talk Mic (`bg-[#0A0A0A]`, turns `#047857` + 5-bar meter while recording) + adjacent `44px` `Parchi` camera pill.
- **3-Tab Bottom Bar (`58px` + `env(safe-area-inset-bottom)`)**: `Munshi`, `Khata`, `Maal`.

### Screen 2: `Tier-2 Review Sheet` (Chaos Voice Bottom Sheet)
- **Sheet Geometry**: `rounded-t-[24px] bg-white max-h-[88dvh]`, `36×4px` drag handle, `300ms var(--ease-spring)`.
- **Header**: `Review Entry` + `96% Match` green pill + 2-line verbatim Urdu/Roman-Urdu transcript box (`bg-[#F2F2F7]`).
- **3-Ali Disambiguation Rail**: Horizontal `48px` tactile chips (`Chhote Ali · Khata Rs. 1,400`, `Ali Driver · Rs. 0`, `Ali Tailor · Rs. 650`); selected chip uses `#0A0A0A` fill with white text.
- **Itemized Table + `QuickAddChip`**: Deterministic rows (`Cheeni 375g / 1.5 pao = Rs. 60`, `Khula Oil = Rs. 250`), inline dashed teal `+ QuickAdd "Khula Oil" to Maal` chip for uncataloged SKUs, isolated `#FEE2E2/50` `-Rs. 30` discount row, and bold `Net Bill` row.
- **Split Settlement Box**: 2-column `#F2F2F7` box showing `Cash Received` (`Rs. 400`) and `Khata Adjustment` (`-Rs. 120`, `New bal: Rs. 1,280`).
- **Sticky Footer**: `Cancel` (`h-12 px-4`) + full-width `Confirm & Save` (`h-12 bg-[#0A0A0A] text-white rounded-[14px]`).

### Screen 3: `</> X-Ray Inspector Sheet` (Judge Proof Drawer)
- **Header**: `</> X-Ray Inspector` + `LIVE` green mono pill + close button.
- **4 Numbered Hairline Rows** (`grid-cols-[26px_1fr]`):
  - `01` **Transcript** (`3.5-flash-lite` + latency ms).
  - `02` **PakPhone + Desi Math** (`1.8ms` green badge + phonetic score + unit formula).
  - `03` **Balanced Journal** (`Δ = 0 ✓` badge + `DR 1010 Cash`, `CR 4010 Sales`, `CR 1120 A/R`).
  - `04` **SHA-256 Chain + RLS** (`RLS ON` badge + `entry_hash` + `shop_id`).
- **Footer**: `Replay Test` button (`h-11 rounded-xl`) firing identical `idempotency_key` -> flips inline green badge to `200 OK · 0 Dupes`.

### Screen 4: `Khata` (Tab 2 — Udhaar & Recovery)
- **Header**: `Khata` + `SMEConnect` dark pill (`QrCode` icon -> opens Screen 6).
- **Hero Receivable Card**: `34px Bold` `#C2410C` tabular total + active/overdue sub-strip.
- **iOS Segmented Control (`34px`)**: `All`, `Overdue`, `Settled`.
- **Debtor Rows**: Name + `18d overdue` `#FEE2E2` badge + balance + 3 action pills: `Wasooli` (`#DCFCE7`), `WhatsApp` (`wa.me`), and `SMS (2G)` (`sms:`).

### Screen 5: `Maal` + Crinkled Parchi OCR Review Sheet
- **Maal View**: Header + teal `+ Scan Parchi` pill; non-blocking `#FEE2E2` negative-stock banner with `Fix` button; inset stock list with `4px` teal/amber progress bars.
- **Parchi Review Sheet**: Cropped receipt preview strip + extracted lines (`Surf Excel`, amber `MATH_MISMATCH` row with `Use Rs. 7,350` vs `Keep Rs. 7,650` toggle, `New Item` teal badge for `Tapal Danedar 900g`) + sticky `Restock Commit` (`#0F766E`) CTA.

### Screen 6: `Ed25519 QR SMEConnect Trade Passport` (Apple Wallet Pass)
- **Dark Wallet Card**: `rounded-[20px] bg-[#0F172A] text-white border border-[#10B981]/30` with `3px` `#10B981` top trim.
- **Contents**: `DukaanOS SMEConnect` + `Ed25519 VERIFIED` pill; Merchant name & location; 3-column metrics (`30D GMV`, `Cash/Credit`, `Recovery %`); `SHA-256 9f8a…4c2e` + `SIG VALID ✓`; centered `144×144px` white QR card + `dukaanos.pk/verify` link; mandatory non-underwriting disclaimer footer.
