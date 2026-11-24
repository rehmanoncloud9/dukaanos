/**
 * PakPhone — deterministic offline phonetic matcher for Roman Urdu / Urdu /
 * Punjabi / English shop vocabulary. Runs identically in the browser and on the
 * server, costs Rs. 0 in LLM calls, and reports its own latency for the X-Ray.
 */

const DIACRITICS = /[ً-ٰٟۖ-ۭ]/g;

const HOMOGLYPHS: Array<[RegExp, string]> = [
  [/ك/g, "ک"],
  [/[يىۓ]/g, "ی"],
  [/ے/g, "ی"],
  [/[ۃة]/g, "ہ"],
  [/ھ/g, "ہ"],
  [/[أإٱ]/g, "ا"],
  [/آ/g, "ا"],
  [/ؤ/g, "و"],
  [/ئ/g, "ی"],
];

const URDU_TO_ROMAN: Record<string, string> = {
  "ا": "a", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s", "ج": "j", "چ": "ch",
  "ح": "h", "خ": "kh", "د": "d", "ڈ": "d", "ذ": "z", "ر": "r", "ڑ": "r", "ز": "z",
  "ژ": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z", "ع": "a",
  "غ": "gh", "ف": "f", "ق": "q", "ک": "k", "گ": "g", "ل": "l", "م": "m", "ن": "n",
  "ں": "n", "و": "o", "ہ": "h", "ء": "", "ی": "i",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Particles that carry no identity ("sarson KA tel", "doodh WALA"). */
const PARTICLES = new Set(["ka", "ki", "ke", "da", "di", "de", "wala", "wali", "waley", "walay", "ko", "nu", "ne", "the", "of"]);

/** Fold Urdu homoglyphs + strip diacritics. Keeps script. */
export function normalizeUrdu(s: string): string {
  let out = s.normalize("NFC").replace(DIACRITICS, "");
  for (const [re, rep] of HOMOGLYPHS) out = out.replace(re, rep);
  return out;
}

/** Urdu script → rough Roman, so "چینی" can meet "cheeni". */
export function transliterate(s: string): string {
  const folded = normalizeUrdu(s);
  let out = "";
  for (const ch of folded) out += URDU_TO_ROMAN[ch] ?? ch;
  return out;
}

const MEMO_LIMIT = 20_000;
const normMemo = new Map<string, string>();
const keyMemo = new Map<string, string>();

function memo(map: Map<string, string>, k: string, f: (s: string) => string): string {
  const hit = map.get(k);
  if (hit !== undefined) return hit;
  const v = f(k);
  if (map.size > MEMO_LIMIT) map.clear();
  map.set(k, v);
  return v;
}

/** Lowercase Roman text with particles and punctuation removed. */
export function normalizeText(s: string): string {
  return memo(normMemo, s, normalizeTextRaw);
}

function normalizeTextRaw(s: string): string {
  return transliterate(s)
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !PARTICLES.has(t))
    .join(" ");
}

/** Indo-Iranic phonetic key for a single token. */
export function phoneticKey(token: string): string {
  return memo(keyMemo, token, phoneticKeyRaw);
}

function phoneticKeyRaw(token: string): string {
  let t = normalizeText(token).replace(/\s+/g, "");
  if (!t) return "";
  t = t
    .replace(/chh/g, "c")
    .replace(/ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/bh/g, "b")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/jh/g, "j")
    .replace(/rh/g, "r")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/x/g, "ks")
    .replace(/ee|ii|ea|ie/g, "i")
    .replace(/oo|ou|uu/g, "u")
    .replace(/aa/g, "a")
    .replace(/ay|ai|ey|ei/g, "i")
    .replace(/au|aw/g, "o")
    .replace(/e/g, "i")
    .replace(/o/g, "u")
    .replace(/y/g, "i")
    .replace(/h/g, "");
  // collapse doubled letters, then drop trailing vowels (anda/anday, cheeni/chini)
  t = t.replace(/(.)\1+/g, "$1");
  const stripped = t.replace(/[aiu]+$/g, "");
  return stripped.length >= 2 ? stripped : t;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/** Token similarity: blends phonetic-key and surface similarity. */
const simMemo = new Map<string, number>();

export function tokenSimilarity(a: string, b: string): number {
  const k = `${a}\u0000${b}`;
  const hit = simMemo.get(k);
  if (hit !== undefined) return hit;
  const v = tokenSimilarityRaw(a, b);
  if (simMemo.size > MEMO_LIMIT) simMemo.clear();
  simMemo.set(k, v);
  return v;
}

function tokenSimilarityRaw(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  const ka = phoneticKey(na);
  const kb = phoneticKey(nb);
  if (ka && ka === kb) return 0.97;
  return 0.65 * ratio(ka, kb) + 0.35 * ratio(na, nb);
}

/** Phrase similarity (0..1) between a spoken mention and a catalog name. */
export function phraseSimilarity(query: string, name: string): number {
  const q = normalizeText(query);
  const n = normalizeText(name);
  if (!q || !n) return 0;
  if (q === n) return 1;
  const qt = q.split(" ");
  const nt = n.split(" ");
  const whole = tokenSimilarity(q.replace(/\s+/g, ""), n.replace(/\s+/g, ""));
  // every query token must find a partner in the name
  let sum = 0;
  for (const t of qt) {
    let best = 0;
    for (const u of nt) best = Math.max(best, tokenSimilarity(t, u));
    sum += best;
  }
  const coverage = sum / qt.length;
  // penalise names with many extra tokens slightly
  const extra = Math.max(0, nt.length - qt.length) * 0.03;
  return Math.max(0, Math.min(1, Math.max(whole, coverage * 0.95 - extra)));
}

export interface CatalogEntry {
  id: string;
  /** primary display name */
  name: string;
  /** spoken synonyms in any script */
  aliases?: string[];
}

export interface MatchResult {
  id: string;
  name: string;
  score: number;
  matched: string;
  key: string;
}

export interface MatchReport {
  query: string;
  key: string;
  results: MatchResult[];
  ms: number;
}

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Rank catalog entries against a spoken mention. */
export function matchCatalog(query: string, entries: CatalogEntry[], limit = 5): MatchReport {
  const t0 = now();
  const results: MatchResult[] = [];
  for (const e of entries) {
    let best = 0;
    let matched = e.name;
    for (const cand of [e.name, ...(e.aliases ?? [])]) {
      const s = phraseSimilarity(query, cand);
      if (s > best) {
        best = s;
        matched = cand;
      }
      if (best === 1) break;
    }
    results.push({ id: e.id, name: e.name, score: round3(best), matched, key: phoneticKey(matched) });
  }
  results.sort((a, b) => b.score - a.score);
  const ms = now() - t0;
  return {
    query,
    key: normalizeText(query).split(" ").map(phoneticKey).join(" "),
    results: results.slice(0, limit),
    ms: Math.round(ms * 100) / 100,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const PRODUCT_MATCH_THRESHOLD = 0.72;
export const CUSTOMER_CANDIDATE_THRESHOLD = 0.6;

/**
 * Customer candidates for disambiguation chips: anyone scoring above the floor
 * or sharing an exact phonetic token (the "3 Alis" case).
 */
export function customerCandidates(query: string, entries: CatalogEntry[], limit = 3): MatchReport {
  const report = matchCatalog(query, entries, entries.length);
  const qKeys = new Set(normalizeText(query).split(" ").map(phoneticKey).filter(Boolean));
  const filtered = report.results.filter((r) => {
    if (r.score >= CUSTOMER_CANDIDATE_THRESHOLD) return true;
    const entry = entries.find((e) => e.id === r.id);
    const names = [entry?.name ?? "", ...(entry?.aliases ?? [])];
    return names.some((n) => normalizeText(n).split(" ").some((t) => qKeys.has(phoneticKey(t))));
  });
  return { ...report, results: filtered.slice(0, limit) };
}

/** Ambiguous when the runner-up is close to the winner or the winner is weak. */
export function isAmbiguous(results: MatchResult[]): boolean {
  if (results.length === 0) return true;
  if (results[0].score < 0.9) return true;
  if (results.length > 1 && results[0].score - results[1].score < 0.15) return true;
  return false;
}
