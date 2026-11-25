export const colors = {
  // Daylight Financial Surfaces & High-Contrast Ink (DESIGN.md §2)
  canvas: "#F2F2F7",
  surface: "#FFFFFF",
  surfaceSunken: "#EBEBEF",
  ink: "#0A0A0A",
  ink2: "#52525B",
  ink3: "#71717A",

  // Semantic Accents
  cash: "#047857",
  cashBg: "#DCFCE7",
  cashInk: "#14532D",
  cashBright: "#34D399",

  udhaar: "#C2410C",
  udhaarBg: "#FEE2E2",
  udhaarInk: "#991B1B",

  maal: "#0F766E",
  maalBg: "#F0FDFA",

  amberBg: "#FEF3C7",
  amberInk: "#92400E",

  // Apple Wallet Pass Surface (Screen 6)
  passBg: "#0F172A",
  passElevated: "#1E293B",
  passEmerald: "#10B981",
  passInk: "#F8FAFC",
  passMuted: "#94A3B8",

  // Hairlines & borders
  borderCard: "rgba(0, 0, 0, 0.08)",
  borderHairline: "rgba(0, 0, 0, 0.06)",
  borderStrong: "rgba(0, 0, 0, 0.15)",
  scrim: "rgba(0, 0, 0, 0.32)",
} as const;

export const radii = {
  card: 16,
  sheet: 24,
  pass: 20,
  cta: 14,
  chip: 12,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const typography = {
  heroPkr: { fontSize: 34, lineHeight: 38, letterSpacing: -0.9 },
  pulseMetric: { fontSize: 22, lineHeight: 26, letterSpacing: -0.4 },
  tabTitle: { fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  sheetTitle: { fontSize: 17, lineHeight: 22, letterSpacing: -0.25 },
  rowTitle: { fontSize: 15, lineHeight: 20 },
  meta: { fontSize: 13, lineHeight: 18 },
  eyebrow: { fontSize: 11, lineHeight: 14, letterSpacing: 0.65 },
  mono: { fontSize: 11.5, lineHeight: 16 },
  urduUi: { fontSize: 15, lineHeight: 26 },
  urduRead: { fontSize: 16, lineHeight: 34 },
} as const;

export const ICON_STROKE = 1.75;
export const MIN_TARGET_DP = 48;
export const MIC_BUTTON_DP = 66;
