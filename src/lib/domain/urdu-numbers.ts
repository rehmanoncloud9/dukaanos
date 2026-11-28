/**
 * Deterministic Urdu/Roman Urdu number parsing.
 *
 * Values use integer hundredths so quarter expressions and rupee paisa remain
 * exact. Parsers return null for unsupported, malformed, ambiguous, or unsafe
 * input; callers must preserve the original phrase and request review.
 */

export interface ParsedDesiNumber {
  /** Exact value multiplied by 100 (250.00 -> 25_000). */
  hundredths: number;
  /** Convenience numeric value. Do not use this field for money storage. */
  value: number;
  raw: string;
  normalized: string;
}

export interface ParsedRupeeAmount {
  /** Integer paisa. */
  paisa: number;
  /** Convenience numeric rupee value. */
  rupees: number;
  raw: string;
  normalized: string;
}

const MAX_WORDS = 12;
const SAFE_LIMIT = Number.MAX_SAFE_INTEGER;

const URDU_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

const URDU_WORDS: Record<string, string> = {
  "ایک": "ek", "اک": "ek", "دو": "do", "تین": "teen", "چار": "char",
  "پانچ": "panch", "چھ": "chhe", "سات": "saat", "آٹھ": "aath", "اٹھ": "aath",
  "نو": "nau", "دس": "das", "گیارہ": "gyarah", "بارہ": "barah", "تیرہ": "terah",
  "چودہ": "chaudah", "پندرہ": "pandrah", "سولہ": "solah", "سترہ": "satrah",
  "اٹھارہ": "atharah", "انیس": "unees", "بیس": "bees", "اکیس": "ikkees",
  "بائیس": "baees", "تئیس": "teees", "چوبیس": "chaubees", "پچیس": "pachees",
  "تیس": "tees", "پینتیس": "paintees", "چالیس": "chalees", "پینتالیس": "paintalees",
  "پچاس": "pachas", "پچپن": "pachpan", "ساٹھ": "saath", "پینسٹھ": "painsath",
  "ستر": "sattar", "پچھتر": "pachattar", "اسی": "assi", "پچاسی": "pachasi",
  "نوے": "nabbe", "پچانوے": "pachanve", "سو": "sau",
  "آدھا": "adha", "آدھی": "adha", "ادھا": "adha", "ادھی": "adha",
  "سوا": "sawa", "ڈیڑھ": "dedh", "ڈیرھ": "dedh", "دیرھ": "dedh",
  "ڈھائی": "dhai", "دھائی": "dhai", "پونے": "paune", "پونا": "paune",
  "ہزار": "hazaar", "لاکھ": "lakh", "لکھ": "lakh",
  "کلو": "kilo", "کلوگرام": "kg", "گرام": "gram",
  "پاؤ": "pao", "پاو": "pao", "لیٹر": "litre", "لٹر": "litre",
  "ملی": "ml", "درجن": "darjan", "عدد": "adad", "پیس": "pcs", "پیکٹ": "packet",
  "ٹن": "tin", "ڈبہ": "dabba", "کارٹن": "carton", "کارتن": "carton", "بوری": "bori",
  "بیگ": "bag", "پیٹی": "peti", "روپے": "rupay", "روپیہ": "rupay",
  "روپیا": "rupay", "نقد": "naqd", "نکد": "naqd", "کیش": "cash", "جمع": "jama",
};

const ROMAN_WORDS: Record<string, string> = {
  aik: "ek", ik: "ek", ikk: "ek", one: "ek",
  dou: "do", two: "do", three: "teen", char: "char", chaar: "char", four: "char",
  panch: "panch", paanch: "panch", punj: "panch", five: "panch",
  chay: "chhe", chhay: "chhe", che: "chhe", six: "chhe", sat: "saat", seven: "saat",
  ath: "aath", eight: "aath", nine: "nau", ten: "das", dus: "das",
  eleven: "gyarah", twelve: "barah", thirteen: "terah", fourteen: "chaudah", fifteen: "pandrah",
  sixteen: "solah", seventeen: "satrah", eighteen: "atharah", nineteen: "unees",
  bees: "bees", twenty: "bees", ikkees: "ikkees", ikkis: "ikkees", baees: "baees", bais: "baees",
  teees: "teees", teis: "teees", chaubees: "chaubees", chobis: "chaubees",
  pachees: "pachees", pachis: "pachees", chhabbees: "chhabbees", chhabis: "chhabbees",
  sattaees: "sattaees", satais: "sattaees", atthaees: "atthaees", athais: "atthaees",
  untees: "untees", untis: "untees", tees: "tees", thirty: "tees",
  iktees: "iktees", battees: "battees", taintees: "taintees", chauntees: "chauntees",
  paintees: "paintees", paintis: "paintees", chhattees: "chhattees", saintees: "saintees",
  adtees: "adtees", untalees: "untalees",
  chalees: "chalees", chalis: "chalees", forty: "chalees",
  iktalees: "iktalees", bayalees: "bayalees", taintalees: "taintalees", chawalees: "chawalees",
  paintalees: "paintalees", chhiyalees: "chhiyalees", saintalees: "saintalees",
  adtalees: "adtalees", unchaas: "unchaas",
  pachas: "pachas", pachaas: "pachas", fifty: "pachas",
  ikyawan: "ikyawan", bawan: "bawan", tirpan: "tirpan", chauwan: "chauwan",
  pachpan: "pachpan", chhappan: "chhappan", sattawan: "sattawan", atthawan: "atthawan", unsath: "unsath",
  saath: "saath", sixty: "saath", iksath: "iksath", basath: "basath", tirsath: "tirsath",
  chausath: "chausath", painsath: "painsath", chhiyasath: "chhiyasath", sarsath: "sarsath",
  adsath: "adsath", unhattar: "unhattar",
  sattar: "sattar", seventy: "sattar", ikhattar: "ikhattar", bahattar: "bahattar",
  tihattar: "tihattar", chauhattar: "chauhattar", pachattar: "pachattar", chhihattar: "chhihattar",
  satattar: "satattar", athattar: "athattar", unasi: "unasi",
  assi: "assi", eighty: "assi", ikyasi: "ikyasi", bayasi: "bayasi", tirasi: "tirasi",
  chaurasi: "chaurasi", pachasi: "pachasi", chhiyasi: "chhiyasi", sattasi: "sattasi",
  athasi: "athasi", nawasi: "nawasi",
  nabbe: "nabbe", ninety: "nabbe", ikyanve: "ikyanve", banve: "banve", tiranve: "tiranve",
  chauranve: "chauranve", pachanve: "pachanve", chhiyanve: "chhiyanve", sattanve: "sattanve",
  athanve: "athanve", ninyanve: "ninyanve",
  so: "sau", soo: "sau", sau: "sau", hundred: "sau",
  hazar: "hazaar", hazaar: "hazaar", hajaar: "hazaar", thousand: "hazaar",
  lakh: "lakh", lac: "lakh", lakhs: "lakh",
  aadha: "adha", adha: "adha", aadhi: "adha", adhi: "adha", adhaa: "adha", half: "adha",
  sawa: "sawa", sava: "sawa", sawah: "sawa", dedh: "dedh", derh: "dedh", dirh: "dedh", deedh: "dedh",
  dhai: "dhai", dhaai: "dhai", adhai: "dhai", arhai: "dhai", paune: "paune", pauna: "paune", pone: "paune",
  rupay: "rupay", rupaye: "rupay", rupees: "rupay", rupee: "rupay", rupiya: "rupay", rupia: "rupay",
  cash: "cash", naqd: "naqd", nakad: "naqd", jama: "jama", jamaa: "jama", jmaa: "jama",
  kilo: "kilo", kilos: "kilo", kg: "kg", kgs: "kg", gram: "gram", grams: "gram", gm: "gm", gms: "gm", g: "g",
  pao: "pao", pau: "pao", paav: "pao", pav: "pao", kgm: "kg", litre: "litre", liter: "litre",
  ltr: "litre", ml: "ml", darjan: "darjan", darzan: "darjan", dozen: "darjan",
  pc: "pcs", pcs: "pcs", piece: "pcs", pieces: "pcs",
  packet: "packet", packets: "packet", pkt: "packet", pack: "packet", packs: "packet",
  tin: "tin", tins: "tin", dabba: "dabba", dibba: "dabba", dabbe: "dabba",
  bottle: "bottle", bottles: "bottle", botal: "bottle",
  sachet: "sachet", sachets: "sachet", pouch: "pouch", pouches: "pouch",
  roll: "roll", rolls: "roll", bar: "bar", bars: "bar",
  carton: "carton", cartons: "carton", bori: "bori", box: "box", boxes: "box", peti: "peti", bag: "bag",
};

const INTEGER_WORDS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9,
  das: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16,
  satrah: 17, atharah: 18, unees: 19, bees: 20,
  ikkees: 21, baees: 22, teees: 23, chaubees: 24, pachees: 25, chhabbees: 26, sattaees: 27, atthaees: 28, untees: 29,
  tees: 30, iktees: 31, battees: 32, taintees: 33, chauntees: 34, paintees: 35, chhattees: 36, saintees: 37, adtees: 38, untalees: 39,
  chalees: 40, iktalees: 41, bayalees: 42, taintalees: 43, chawalees: 44, paintalees: 45, chhiyalees: 46, saintalees: 47, adtalees: 48, unchaas: 49,
  pachas: 50, ikyawan: 51, bawan: 52, tirpan: 53, chauwan: 54, pachpan: 55, chhappan: 56, sattawan: 57, atthawan: 58, unsath: 59,
  saath: 60, iksath: 61, basath: 62, tirsath: 63, chausath: 64, painsath: 65, chhiyasath: 66, sarsath: 67, adsath: 68, unhattar: 69,
  sattar: 70, ikhattar: 71, bahattar: 72, tihattar: 73, chauhattar: 74, pachattar: 75, chhihattar: 76, satattar: 77, athattar: 78, unasi: 79,
  assi: 80, ikyasi: 81, bayasi: 82, tirasi: 83, chaurasi: 84, pachasi: 85, chhiyasi: 86, sattasi: 87, athasi: 88, nawasi: 89,
  nabbe: 90, ikyanve: 91, banve: 92, tiranve: 93, chauranve: 94, pachanve: 95, chhiyanve: 96, sattanve: 97, athanve: 98, ninyanve: 99,
};

const FRACTIONS_HUNDREDTHS: Record<string, number> = {
  adha: 50,
  dedh: 150,
  dhai: 250,
  sawa: 125,
  paune: 75,
};

const MAGNITUDES: Record<string, number> = { sau: 100, hazaar: 1_000, lakh: 100_000 };
const RUPEE_TAIL = new Set([
  "rupay", "rs", "pkr", "cash", "naqd", "jama", "diya", "diye", "karwaye", "karwaya",
  "mile", "mila", "chhor", "chor", "chhod", "chhorh", "chhorr", "chod", "kam", "discount",
  "riayat", "less", "off", "maaf", "kaat", "do", "wala", "wali", "walay", "paid", "received",
  "wasool", "bheje", "bheja", "hai", "hain", "de", "mein", "par", "pe", "sirf", "only",
]);
const QUANTITY_TAIL = new Set([
  "kg", "kilo", "gram", "grams", "gm", "g", "pao", "pau", "ml", "litre", "liter", "l",
  "darjan", "pcs", "piece", "adad", "packet", "tin", "dabba", "bottle", "sachet", "pouch",
  "roll", "bar", "carton", "bori", "box", "pack", "peti", "bag",
]);

/** Normalize Urdu and Arabic-Indic digits and decimal/group separators only. */
export function normalizeUrduNumerals(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[۰-۹٠-٩]/g, (digit) => URDU_DIGITS[digit] ?? digit)
    .replace(/[٫]/g, ".")
    .replace(/[٬]/g, ",");
}

/** Convert number-word tokens to canonical Roman Urdu while retaining all other text. */
export function normalizeUrduNumberWords(input: string): string {
  const noMarks = normalizeUrduNumerals(input).replace(/[\u064B-\u065F\u0670]/g, "");
  const protectedText = noMarks.replace(/(?<=\d)[,.](?=\d)/g, (separator) => separator === "." ? "\uE000" : "\uE001");
  return protectedText
    .split(/([\s,،;:!?؟.۔()\[\]{}+])/)
    .map((piece) => {
      const key = piece.toLowerCase();
      return URDU_WORDS[piece] ?? ROMAN_WORDS[key] ?? piece;
    })
    .join("")
    .replace(/[،;:!?؟.۔()\[\]{}+]/g, " ")
    .replace(/\uE000/g, ".")
    .replace(/\uE001/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDecimalToken(token: string): number | null {
  const validGrouping = /^\d+(?:\.\d{1,2})?$/.test(token)
    || /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(token)
    || /^\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/.test(token);
  if (!validGrouping) return null;
  const normalized = token.replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.split(".");
  const wholeNumber = Number(whole);
  const fraction = Number((decimal + "00").slice(0, 2));
  const hundredths = wholeNumber * 100 + fraction;
  return Number.isSafeInteger(hundredths) && hundredths <= SAFE_LIMIT ? hundredths : null;
}

function parseNumberTokens(tokens: string[], start = 0): { hundredths: number; consumed: number } | null {
  if (start >= tokens.length) return null;
  let total = 0;
  let group = 0;
  let consumed = 0;
  let found = false;
  let lastMagnitude = Number.POSITIVE_INFINITY;

  const initialDigit = parseDecimalToken(tokens[start]);
  if (initialDigit !== null) {
    group = initialDigit;
    consumed = 1;
    found = true;
  }

  while (start + consumed < tokens.length && consumed < MAX_WORDS) {
    const token = tokens[start + consumed];
    const digit = parseDecimalToken(token);
    if (digit !== null) {
      // Support mixed expressions such as `2 sau 50` and `2 hazaar 500`,
      // while rejecting ambiguous adjacent figures (`2 500`) or out-of-scale tails (`2 sau 500`).
      if (lastMagnitude === Number.POSITIVE_INFINITY || group !== 0) break;
      if (digit >= lastMagnitude * 100) return null;
      group = digit;
      consumed++;
      found = true;
      continue;
    }
    const magnitude = MAGNITUDES[token];
    if (magnitude !== undefined) {
      if (magnitude === lastMagnitude) return null;
      if (magnitude > lastMagnitude) {
        if (lastMagnitude === Number.POSITIVE_INFINITY) return null;
        const scaled = (total + group) * magnitude;
        if (!Number.isSafeInteger(scaled)) return null;
        total = scaled;
        group = 0;
        lastMagnitude = magnitude;
        consumed++;
        found = true;
        continue;
      }
      const multiplier = group !== 0 ? group : total > 0 || !found ? 100 : 0;
      const part = multiplier * magnitude;
      if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total + part)) return null;
      total += part;
      group = 0;
      lastMagnitude = magnitude;
      consumed++;
      found = true;
      continue;
    }

    let term: number | undefined;
    if (token === "sawa" || token === "paune") {
      const next = tokens[start + consumed + 1];
      const nextWordVal = next ? INTEGER_WORDS[next] : undefined;
      const nextDigitVal = next && /^\d{1,2}$/.test(next) ? Number(next) : undefined;
      const n = nextWordVal ?? nextDigitVal;
      if (n !== undefined && n > 0 && n < 100) {
        term = n * 100 + (token === "sawa" ? 25 : -25);
        if (group !== 0) return null;
        consumed++;
      } else {
        term = FRACTIONS_HUNDREDTHS[token];
      }
    } else {
      term = FRACTIONS_HUNDREDTHS[token] ?? (INTEGER_WORDS[token] === undefined ? undefined : INTEGER_WORDS[token] * 100);
    }

    if (term === undefined) break;
    // Two adjacent standalone numbers without a magnitude (e.g. "ek do", "do teen")
    // represent an ambiguous range rather than a sum.
    if (group !== 0) return null;
    if (!Number.isSafeInteger(group + term)) return null;
    group += term;
    consumed++;
    found = true;
  }

  const hundredths = total + group;
  if (!found || !Number.isSafeInteger(hundredths) || hundredths < 0 || hundredths > SAFE_LIMIT) return null;
  return { hundredths, consumed };
}

function normalizedTokens(input: string): string[] {
  const normalized = normalizeUrduNumberWords(input).toLowerCase();
  return normalized.split(/[\s]+/).filter(Boolean);
}

/** Parse a strict number phrase such as `dhai sau`, `دو سو پچاس`, or `۲۵۰`. */
export function parseDesiNumber(input: string): ParsedDesiNumber | null {
  const tokens = normalizedTokens(input);
  if (!tokens.length || tokens.length > MAX_WORDS) return null;
  const parsed = parseNumberTokens(tokens);
  if (!parsed || parsed.consumed !== tokens.length) return null;
  return {
    hundredths: parsed.hundredths,
    value: parsed.hundredths / 100,
    raw: input,
    normalized: tokens.join(" "),
  };
}

/** Parse the numeric component of a quantity phrase; units may follow the number. */
export function parseQuantityNumber(input: string): number | null {
  const tokens = normalizedTokens(input.replace(/(\d)([a-z\u0600-\u06ff])/gi, "$1 $2"));
  if (!tokens.length || tokens.length > MAX_WORDS) return null;
  const parsed = parseNumberTokens(tokens);
  if (!parsed) return null;
  if (tokens.slice(parsed.consumed).some((token) => !QUANTITY_TAIL.has(token))) return null;
  return parsed.hundredths / 100;
}

/** Convenience API for callers that need a number but not its raw evidence. */
export function parseUrduNumberPhrase(input: string): number | null {
  return parseDesiNumber(input)?.value ?? null;
}

/**
 * Parse a currency expression into integer paisa. Supports a bare numeric amount,
 * currency/payment markers, and value-first `N ka/ki/ke ...` phrases. Quantity units
 * such as kg, pao, and packet are rejected so quantity speech cannot become money.
 */
export function parseRupeeAmount(input: string): ParsedRupeeAmount | null {
  const cleaned = input
    .replace(/\/-\s*$/g, "")
    .replace(/\b(rs|pkr)\s*(\d)/gi, "$1 $2")
    .replace(/(\d)([a-z\u0600-\u06ff])/gi, "$1 $2");
  const allTokens = normalizedTokens(cleaned);
  const tokens = allTokens[0] === "rs" || allTokens[0] === "pkr" || allTokens[0] === "rupay" ? allTokens.slice(1) : allTokens;
  if (!tokens.length || tokens.length > MAX_WORDS) return null;
  const parsed = parseNumberTokens(tokens);
  if (!parsed) return null;

  const rest = tokens.slice(parsed.consumed);
  if (rest.some((token) => QUANTITY_TAIL.has(token))) return null;
  if (rest.length) {
    const hasValueFirstMarker = ["ka", "ki", "ke"].includes(rest[0]);
    const allMoneyMarkers = rest.every((token) => RUPEE_TAIL.has(token) || ["ka", "ki", "ke"].includes(token));
    if (!hasValueFirstMarker && !allMoneyMarkers) return null;
  }
  if (!Number.isSafeInteger(parsed.hundredths) || parsed.hundredths < 0) return null;
  return {
    paisa: parsed.hundredths,
    rupees: parsed.hundredths / 100,
    raw: input,
    normalized: tokens.join(" "),
  };
}

