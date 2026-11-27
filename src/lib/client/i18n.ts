export type Lang = "en" | "ur";

export const LANG_KEY = "dukaanos.lang";

const DICT = {
  munshi: { en: "Munshi", ur: "منشی" },
  khata: { en: "Khata", ur: "کھاتہ" },
  maal: { en: "Maal", ur: "مال" },
  zeroFbr: { en: "Zero FBR", ur: "ایف بی آر سے پاک" },
  todayCash: { en: "Today cash", ur: "آج کا کیش" },
  todayUdhaar: { en: "Today udhaar", ur: "آج کا ادھار" },
  sales: { en: "sales", ur: "فروخت" },
  accounts: { en: "accounts", ur: "کھاتے" },
  recoverUdhaar: { en: "Recover Overdue Udhaar", ur: "واجب الادا ادھار وصول کریں" },
  stockoutAlert: { en: "2-Day Stockout Alert", ur: "اسٹاک ختم ہونے کی وارننگ" },
  remind: { en: "Remind", ur: "یاددہانی" },
  order: { en: "Order", ur: "آرڈر" },
  allEntries: { en: "All entries", ur: "تمام اندراجات" },
  showLess: { en: "Show less", ur: "کم دکھائیں" },
  loadOlder: { en: "Load older entries", ur: "پرانے اندراجات دیکھیں" },
  emptyMunshi: { en: "Koi entry nahi — mic dabaa kar bolein", ur: "کوئی اندراج نہیں — مائیک دبا کر بولیں" },
  listening: { en: "Munshi sun raha hai…", ur: "منشی سن رہا ہے…" },
  typePlaceholder: { en: "Type Urdu / Roman: Chhote Ali ko dedh pao cheeni…", ur: "اردو یا رومن میں لکھیں: چھوٹے علی کو ڈیڑھ پاؤ چینی…" },
  parchi: { en: "Parchi", ur: "پرچی" },
  scanParchi: { en: "Scan Parchi", ur: "پرچی اسکین" },
  holdToTalk: { en: "Hold to talk (or press Space to toggle)", ur: "بولنے کے لیے دبائیں" },
  typeInstead: { en: "Type instead", ur: "ٹائپ کریں" },
  totalReceivable: { en: "Total receivable", ur: "کل وصولی" },
  activeAccounts: { en: "active accounts", ur: "فعال کھاتے" },
  overdue: { en: "overdue", ur: "تاخیر" },
  all: { en: "All", ur: "سب" },
  overdueFilter: { en: "Overdue", ur: "باقی" },
  settled: { en: "Settled", ur: "بے باق" },
  newCustomer: { en: "New customer", ur: "نیا گاہک" },
  wasooli: { en: "Wasooli", ur: "وصولی" },
  lowStock: { en: "Low stock", ur: "کم اسٹاک" },
  healthy: { en: "Healthy", ur: "مکمل" },
  negative: { en: "Negative", ur: "منفی" },
  settings: { en: "Settings", ur: "ترتیبات" },
  language: { en: "Language", ur: "زبان" },
  exportData: { en: "Export my data", ur: "میرا ڈیٹا ڈاؤن لوڈ کریں" },
  deleteAccount: { en: "Delete account", ur: "اکاؤنٹ حذف کریں" },
  privacy: { en: "Privacy", ur: "پرائیویسی" },
  terms: { en: "Terms", ur: "شرائط" },
  signOut: { en: "Sign out", ur: "سائن آؤٹ" },
  judgeModeOn: { en: "Judge Mode ON — every commit opens </> X-Ray", ur: "جج موڈ آن — ہر اندراج پر X-Ray کھلے گا" },
  swUpdate: { en: "New version ready — tap to update", ur: "نیا ورژن تیار ہے — اپ ڈیٹ کریں" },
  insights: { en: "Insights · P&L", ur: "منافع اور رپورٹ" },
  newBill: { en: "New Bill", ur: "نیا بل" },
  returnItem: { en: "Return", ur: "واپسی" },
  autoSpeak: { en: "Spoken Urdu confirmations", ur: "ہر اندراج پر اردو آواز میں تصدیق" },
} as const;

export type I18nKey = keyof typeof DICT;

export function tr(key: I18nKey, lang: Lang): string {
  return DICT[key][lang];
}
