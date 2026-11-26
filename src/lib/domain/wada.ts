/**
 * Wada (promise-to-pay) date resolver — deterministic, offline, Pakistan time (UTC+5, no DST).
 * Understands Roman Urdu / Urdu: aaj, kal, parson, weekdays (Jumma, Itwaar…), "agle hafte",
 * "X din", "tankhwah" / "1 tareekh" / "mahine ki 1" (salary day = 1st of next month).
 * Returns an ISO date (YYYY-MM-DD) or null. Never guesses a past date.
 */

const PKT_OFFSET_MS = 5 * 3600_000;

/** Today's calendar date in Pakistan as a UTC-midnight Date. */
export function pktToday(now = new Date()): Date {
  const p = new Date(now.getTime() + PKT_OFFSET_MS);
  return new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400_000);
}

// 0 = Sunday … 6 = Saturday
const WEEKDAYS: Array<[RegExp, number]> = [
  [/\b(itwa+r|sunday)\b|اتوار/i, 0],
  [/\b(peer|pir|somwar|monday)\b|پیر/i, 1],
  [/\b(mangal|tuesday)\b|منگل/i, 2],
  [/\b(budh|budhwar|wednesday)\b|بدھ/i, 3],
  [/\b(jumeraat|jumerat|thursday)\b|جمعرات/i, 4],
  [/\b(jumm?a|jumm?e|friday)\b|جمعہ|جمعے/i, 5],
  [/\b(saturday|hafte\s+ke\s+din)\b|ہفتہ/i, 6],
];

const NUM_WORDS: Record<string, number> = { ek: 1, do: 2, teen: 3, char: 4, chaar: 4, panch: 5, paanch: 5, chhe: 6, che: 6, saat: 7, das: 10 };

export function resolveWada(text: string, now = new Date()): string | null {
  const t = ` ${text.toLowerCase().normalize("NFC")} `;
  const today = pktToday(now);

  if (/\b(aaj|aj|today)\b|آج/.test(t)) return isoDate(today);
  if (/\b(parson|parso|parsoon)\b|پرسوں/.test(t)) return isoDate(addDays(today, 2));
  if (/\b(kal|tomorrow)\b|کل/.test(t)) return isoDate(addDays(today, 1));

  // "tankhwah", "1 tareekh", "mahine ki pehli", "salary" → 1st of next month
  if (/\b(tankh?wa+h?|salary|pehli\s+tareekh|1\s*(tareekh|tarikh)|mahine\s+ki\s+(1|pehli))\b|تنخواہ/.test(t)) {
    return isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));
  }

  // "N din (baad|mein)"
  const nDays = t.match(/\b(\d{1,2}|ek|do|teen|chaa?r|paa?nch|chhe|che|saat|das)\s*(din|dino|days?)\b/);
  if (nDays) {
    const n = /^\d+$/.test(nDays[1]) ? Number(nDays[1]) : NUM_WORDS[nDays[1]];
    if (n && n > 0 && n <= 90) return isoDate(addDays(today, n));
  }

  if (/\b(agle|agla|next)\s+(hafte|hafta|week)\b|اگلے ہفتے/.test(t)) return isoDate(addDays(today, 7));

  for (const [re, dow] of WEEKDAYS) {
    if (re.test(t)) {
      const delta = (dow - today.getUTCDay() + 7) % 7 || 7; // "Jumma" said on a Friday means next Friday
      return isoDate(addDays(today, delta));
    }
  }
  return null;
}

/** One-tap choices for the customer page (labels in Roman Urdu). */
export function quickWadaOptions(now = new Date()): Array<{ label: string; date: string }> {
  return [
    { label: "Kal", date: resolveWada("kal", now)! },
    { label: "Jumma", date: resolveWada("jumma", now)! },
    { label: "Agle hafte", date: resolveWada("agle hafte", now)! },
    { label: "Tankhwah (1 tareekh)", date: resolveWada("tankhwah", now)! },
  ];
}

/** "Jumma, 28 Nov" style label for a promise date. */
export function wadaLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const days = ["Itwaar", "Peer", "Mangal", "Budh", "Jumeraat", "Jumma", "Hafta"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/** A spoken/typed promise needs BOTH a promise word and a resolvable date. */
export const WADA_REGEX = /\b(wa+da|wa'?da|promise|de\s*de(ga|gi|ngay?)|de(ga|gi)|dunga|doonga|dungi|ada\s+kar(ega|egi|e\s*ga|unga|ungi)|paise\s+de(ga|gi))\b|وعدہ|دے گا|دوں گا/i;

/** "Ali ne Jumme ka wada kiya" / "Bilal kal dega" → ISO date; null when it is not a wada. */
export function detectWadaUtterance(text: string | null | undefined, now = new Date()): string | null {
  if (!text || !WADA_REGEX.test(text)) return null;
  return resolveWada(text, now);
}
