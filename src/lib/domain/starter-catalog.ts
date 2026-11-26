/**
 * Pure domain helpers for market launch:
 * 1) Pakistani +92 phone normalizer for Phone OTP auth.
 * 2) Starter Kiryana Catalog (integer paisa & base_units) for 1-tap new shop onboarding.
 */
import type { BaseUnit } from "./desi-units";

export function normalizePkPhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+92") && digits.length === 13) return digits;
  if (digits.startsWith("92") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("03") && digits.length === 11) return `+92${digits.slice(1)}`;
  if (digits.startsWith("3") && digits.length === 10) return `+92${digits}`;
  throw new Error("Sahih Pakistani mobile number darj karein (03xx-xxxxxxx)");
}

export interface StarterSku {
  sku_code: string;
  name: string;
  name_ur: string;
  aliases: string[];
  base_unit: BaseUnit;
  pack_size_base_units: number;
  unit_price_paisa: number;
  cost_price_paisa: number;
}

export const STARTER_KIRYANA_SKUS: StarterSku[] = [
  { sku_code: "STR-01", name: "Cheeni", name_ur: "چینی", aliases: ["cheeni", "chini", "sugar", "khand"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 16000, cost_price_paisa: 14500 },
  { sku_code: "STR-02", name: "Atta", name_ur: "آٹا", aliases: ["atta", "aata", "flour"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 14000, cost_price_paisa: 12500 },
  { sku_code: "STR-03", name: "Khula Oil", name_ur: "کھلا تیل", aliases: ["khula oil", "oil", "tel", "tail"], base_unit: "ml", pack_size_base_units: 1000, unit_price_paisa: 52000, cost_price_paisa: 48000 },
  { sku_code: "STR-04", name: "Dalda Ghee", name_ur: "گھی", aliases: ["ghee", "dalda", "banaspati"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 54000, cost_price_paisa: 50000 },
  { sku_code: "STR-05", name: "Chai Patti", name_ur: "چائے پتی", aliases: ["patti", "chai patti", "tea", "tapal"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 160000, cost_price_paisa: 145000 },
  { sku_code: "STR-06", name: "Chawal Basmati", name_ur: "چاول", aliases: ["chawal", "rice", "basmati"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 32000, cost_price_paisa: 28500 },
  { sku_code: "STR-07", name: "Daal Chana", name_ur: "دال چنا", aliases: ["daal", "dal", "daal chana"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 28000, cost_price_paisa: 25000 },
  { sku_code: "STR-08", name: "Daal Masoor", name_ur: "دال مسور", aliases: ["masoor", "daal masoor"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 31000, cost_price_paisa: 28000 },
  { sku_code: "STR-09", name: "Doodh", name_ur: "دودھ", aliases: ["doodh", "milk"], base_unit: "ml", pack_size_base_units: 1000, unit_price_paisa: 22000, cost_price_paisa: 19500 },
  { sku_code: "STR-10", name: "Anday", name_ur: "انڈے", aliases: ["anda", "anday", "eggs"], base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 3000, cost_price_paisa: 2600 },
  { sku_code: "STR-11", name: "Sabun", name_ur: "صابن", aliases: ["sabun", "soap", "lifebuoy", "lux"], base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 12000, cost_price_paisa: 10500 },
  { sku_code: "STR-12", name: "Surf Excel", name_ur: "سرف", aliases: ["surf", "washing powder"], base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 5000, cost_price_paisa: 4300 },
  { sku_code: "STR-13", name: "Namak", name_ur: "نمک", aliases: ["namak", "salt"], base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 6000, cost_price_paisa: 5000 },
  { sku_code: "STR-14", name: "Lal Mirch", name_ur: "لال مرچ", aliases: ["mirch", "lal mirch", "chili"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 90000, cost_price_paisa: 80000 },
  { sku_code: "STR-15", name: "Lays", name_ur: "لیز", aliases: ["lays", "chips"], base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 5000, cost_price_paisa: 4200 },
  { sku_code: "STR-16", name: "Coca-Cola 1.5L", name_ur: "کولا", aliases: ["coke", "cola", "bottle", "cold drink"], base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 20000, cost_price_paisa: 17500 },
  { sku_code: "STR-17", name: "Biscuit", name_ur: "بسکٹ", aliases: ["biscuit", "rio", "sooper"], base_unit: "pcs", pack_size_base_units: 1, unit_price_paisa: 4000, cost_price_paisa: 3400 },
  { sku_code: "STR-18", name: "Besan", name_ur: "بیسن", aliases: ["besan"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 30000, cost_price_paisa: 27000 },
  { sku_code: "STR-19", name: "Maida", name_ur: "میدہ", aliases: ["maida"], base_unit: "g", pack_size_base_units: 1000, unit_price_paisa: 16000, cost_price_paisa: 14000 },
  { sku_code: "STR-20", name: "Sarson ka Tel", name_ur: "سرسوں کا تیل", aliases: ["sarson", "sarson da tail", "mustard oil"], base_unit: "ml", pack_size_base_units: 1000, unit_price_paisa: 58000, cost_price_paisa: 53000 },
];
