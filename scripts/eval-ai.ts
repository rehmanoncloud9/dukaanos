/**
 * Offline & opt-in live evaluation framework for DukaanOS P2 AI pipelines.
 *
 * Usage:
 *   tsx scripts/eval-ai.ts --all          # synthetic offline voice + parchi eval (no API key)
 *   tsx scripts/eval-ai.ts --voice        # voice golden fixtures only
 *   tsx scripts/eval-ai.ts --parchi       # parchi golden fixtures only
 *   tsx scripts/eval-ai.ts --all --json   # emit machine-readable JSON report
 *   tsx scripts/eval-ai.ts --voice --live # opt-in live Gemini evaluation (requires GEMINI_API_KEY)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPaymentProposal, buildSaleProposal } from "../src/lib/domain/bill";
import { DEMO_CUSTOMERS, DEMO_PRODUCTS } from "../src/lib/domain/demo-data";
import { parseFallback } from "../src/lib/domain/fallback-parser";
import { parseQuantityPhrase } from "../src/lib/domain/desi-units";
import { parseRupeeAmount } from "../src/lib/domain/urdu-numbers";
import { estimateCostPkrMicros } from "../src/lib/ai/pricing";
import { interpretParchiOcr, PARCHI_OCR_ZOD_SCHEMA } from "../src/lib/ai/parchi";
import { ParsedTurnZ } from "../src/lib/ai/munshi";
import type { Catalog, ParsedTurn } from "../src/lib/domain/types";

interface VoiceFixture {
  id: string;
  category: string;
  utterance: string;
  test_fallback?: boolean;
  mock_extraction: Record<string, unknown>;
  expected: {
    intent: string;
    customer_id?: string;
    tier?: 1 | 2;
    must_require_review?: boolean;
    discount_paisa?: number;
    cash_paid_paisa?: number;
    credit_paisa?: number;
    payment_amount_paisa?: number;
    tier_reasons_include?: string[];
    items?: Array<{
      product_id?: string;
      kind?: string;
      qty_base_units?: number;
      line_total_paisa?: number;
    }>;
  };
}

interface ParchiFixture {
  id: string;
  category: string;
  ocr: Record<string, unknown>;
  expected: {
    line_count: number;
    math_passed: boolean;
    manual_review_required: boolean;
    new_sku_count?: number;
    mismatch_count?: number;
    extracted_total_paisa?: number | null;
    computed_total_paisa?: number | null;
    delta_paisa?: number | null;
    lines: Array<{
      match_status?: string;
      product_id?: string;
      qty_base_units?: number | null;
      rate_paisa?: number | null;
      base_unit?: string;
      pack_size_base_units?: number;
      written_total_paisa?: number | null;
      computed_total_paisa?: number | null;
      line_total_paisa?: number | null;
      math_mismatch?: boolean;
      conversion_unresolved?: boolean;
      issues_include?: string[];
    }>;
  };
}

const BALANCES: Record<string, number> = {
  CHHOTE_ALI: 140000,
  ALI_DRIVER: 0,
  ALI_TAILOR: 65000,
  TARIQ_M: 90000,
  TARIQ_B: 0,
  BILAL: 635000,
};

const catalog: Catalog = {
  products: DEMO_PRODUCTS.map((p) => ({
    id: p.code,
    name: p.name,
    name_ur: p.name_ur,
    base_unit: p.base_unit,
    pack_size_base_units: p.pack,
    unit_price_paisa: p.price_rs * 100,
    cost_price_paisa: p.cost_rs * 100,
    stock_base_units: p.stock_target,
    reorder_level_base_units: p.reorder,
    aliases: p.aliases,
  })),
  customers: DEMO_CUSTOMERS.map((c) => ({
    id: c.code,
    name: c.name,
    role_tag: c.role_tag,
    phone: c.phone,
    balance_paisa: BALANCES[c.code] ?? 0,
    aliases: c.aliases,
  })),
};

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 1000) / 1000;
}

function ratio(pass: number, total: number): number {
  return total === 0 ? 1 : Math.round((pass / total) * 10000) / 10000;
}

function normalizeExtractedTurn(raw: Record<string, unknown>): ParsedTurn {
  const checked = ParsedTurnZ.parse(raw);
  let numberUnresolved = false;
  const items = checked.items.map((item) => {
    const qty = parseQuantityPhrase(item.quantity_phrase);
    const val = item.value_phrase !== null ? parseRupeeAmount(item.value_phrase) : null;
    const itemUnresolved = Boolean(
      (item.quantity_phrase && qty.unresolved)
      || (!item.quantity_phrase && !item.value_phrase)
      || (item.quantity_phrase && item.value_phrase)
      || (item.value_phrase !== null && (!val || (item.value_rupees !== null && parseRupeeAmount(String(item.value_rupees))?.paisa !== val.paisa)))
      || (item.value_phrase === null && item.value_rupees !== null),
    );
    numberUnresolved ||= itemUnresolved;
    return {
      spoken: item.spoken,
      quantity_phrase: item.quantity_phrase,
      value_rupees: itemUnresolved ? null : (val?.rupees ?? null),
      value_phrase: item.value_phrase,
      number_unresolved: itemUnresolved,
      is_loose: item.is_loose,
      confidence: itemUnresolved ? Math.min(item.confidence, 0.5) : item.confidence,
    };
  });

  const checkAmt = (phrase: string | null, claimed: number | null) => {
    if (phrase === null) return { amount: claimed, unresolved: claimed !== null };
    const parsed = parseRupeeAmount(phrase);
    if (!parsed) return { amount: null, unresolved: true };
    if (claimed !== null && parseRupeeAmount(String(claimed))?.paisa !== parsed.paisa) return { amount: null, unresolved: true };
    return { amount: parsed.rupees, unresolved: false };
  };

  const discount = checkAmt(checked.discount_phrase, checked.discount_rupees);
  const cash = checkAmt(checked.cash_phrase, checked.cash_paid_rupees);
  const payment = checkAmt(checked.payment_amount_phrase, checked.payment_amount_rupees);
  numberUnresolved ||= discount.unresolved || cash.unresolved || payment.unresolved;

  const explicitCash = /\b(cash|naqd|nakad|کیش|نقد)\b/i.test(checked.transcript) || /\b(cash|naqd|nakad)\b/i.test(checked.transcript_roman);
  return {
    intent: checked.intent,
    transcript: checked.transcript,
    customer_mention: checked.customer_mention,
    items,
    discount_rupees: discount.amount,
    discount_phrase: checked.discount_phrase,
    cash_paid_rupees: cash.amount,
    cash_phrase: checked.cash_phrase,
    payment_mode: checked.payment_mode,
    payment_amount_rupees: payment.amount,
    payment_amount_phrase: checked.payment_amount_phrase,
    question: checked.question,
    confidence: checked.confidence,
    number_unresolved: numberUnresolved,
    tier1_evidence_verified:
      !numberUnresolved
      && checked.intent === "sale"
      && checked.payment_mode === "cash"
      && explicitCash
      && checked.discount_rupees === null
      && checked.discount_phrase === null
      && checked.confidence >= 0.9
      && items.length > 0
      && items.every((i) => i.confidence >= 0.9 && !i.number_unresolved),
  };
}

async function evaluateVoice(useLive: boolean) {
  const file = path.resolve(process.cwd(), "tests/fixtures/ai/voice/golden-voice-fixtures.json");
  const fixtures = JSON.parse(readFileSync(file, "utf8")) as VoiceFixture[];
  const latencies: number[] = [];
  const fbLatencies: number[] = [];
  const categoryStats = new Map<string, { total: number; passed: number }>();
  const failures: Array<{ id: string; category: string; reasons: string[] }> = [];

  let intentOk = 0;
  let customerTotal = 0;
  let customerOk = 0;
  let itemTotal = 0;
  let itemOk = 0;
  let qtyTotal = 0;
  let qtyOk = 0;
  let amountTotal = 0;
  let amountOk = 0;
  let discountTotal = 0;
  let discountOk = 0;
  let cashCreditTotal = 0;
  let cashCreditOk = 0;
  let semanticOk = 0;
  let safetyTotal = 0;
  let unsafeTier1 = 0;
  let fbTested = 0;
  let fbIntentOk = 0;
  let modelFailures = 0;

  for (const fx of fixtures) {
    const t0 = performance.now();
    let parsed: ParsedTurn;
    if (useLive) {
      const { parseTurn } = await import("../src/lib/ai/munshi");
      try {
        const res = await parseTurn({ text: fx.utterance, catalog, shopName: "Bismillah Kiryana" });
        parsed = res.parsed;
      } catch {
        modelFailures++;
        parsed = parseFallback(fx.utterance);
      }
    } else {
      parsed = normalizeExtractedTurn(fx.mock_extraction);
    }

    const errors: string[] = [];
    if (parsed.intent === fx.expected.intent) intentOk++;
    else errors.push(`intent=${parsed.intent}!=expected:${fx.expected.intent}`);

    if (fx.expected.must_require_review) safetyTotal++;

    if (parsed.intent === "sale") {
      const sale = buildSaleProposal(parsed, catalog);
      if (fx.expected.must_require_review && sale.tier === 1) {
        unsafeTier1++;
        errors.push("unsafe_tier1");
      }
      if (fx.expected.tier !== undefined && sale.tier !== fx.expected.tier) {
        errors.push(`tier=${sale.tier}!=expected:${fx.expected.tier}`);
      }
      if (fx.expected.customer_id) {
        customerTotal++;
        if (sale.customer.selected_id === fx.expected.customer_id) customerOk++;
        else errors.push(`customer=${sale.customer.selected_id}`);
      }
      if (fx.expected.discount_paisa !== undefined) {
        discountTotal++;
        if (sale.discount_paisa === fx.expected.discount_paisa) discountOk++;
        else errors.push(`discount=${sale.discount_paisa}`);
      }
      if (fx.expected.cash_paid_paisa !== undefined || fx.expected.credit_paisa !== undefined) {
        cashCreditTotal++;
        const cashMatch = fx.expected.cash_paid_paisa === undefined || sale.cash_paid_paisa === fx.expected.cash_paid_paisa;
        const creditMatch = fx.expected.credit_paisa === undefined || sale.credit_paisa === fx.expected.credit_paisa;
        if (cashMatch && creditMatch) cashCreditOk++;
        else errors.push(`cash=${sale.cash_paid_paisa},credit=${sale.credit_paisa}`);
      }
      if (fx.expected.tier_reasons_include) {
        for (const r of fx.expected.tier_reasons_include) {
          if (!sale.tier_reasons.includes(r as never)) errors.push(`missing_reason:${r}`);
        }
      }
      if (fx.expected.items) {
        fx.expected.items.forEach((exp, idx) => {
          const line = sale.lines[idx];
          itemTotal++;
          const prodMatch = exp.product_id ? line?.product_id === exp.product_id : line?.kind === exp.kind;
          if (prodMatch) itemOk++;
          else errors.push(`item[${idx}]=${line?.product_id ?? line?.kind}`);
          if (exp.qty_base_units !== undefined) {
            qtyTotal++;
            if (line?.qty_base_units === exp.qty_base_units) qtyOk++;
            else errors.push(`qty[${idx}]=${line?.qty_base_units}`);
          }
          if (exp.line_total_paisa !== undefined) {
            amountTotal++;
            if (line?.line_total_paisa === exp.line_total_paisa) amountOk++;
            else errors.push(`amount[${idx}]=${line?.line_total_paisa}`);
          }
        });
      }
    } else if (parsed.intent === "payment") {
      const payment = buildPaymentProposal(parsed, catalog.customers);
      if (fx.expected.customer_id) {
        customerTotal++;
        if (payment.customer.selected_id === fx.expected.customer_id) customerOk++;
        else errors.push(`customer=${payment.customer.selected_id}`);
      }
      if (fx.expected.payment_amount_paisa !== undefined) {
        amountTotal++;
        if (payment.amount_paisa === fx.expected.payment_amount_paisa) amountOk++;
        else errors.push(`payment_amount=${payment.amount_paisa}`);
      }
    }

    latencies.push(performance.now() - t0);

    if (fx.test_fallback) {
      fbTested++;
      const ft0 = performance.now();
      const fb = parseFallback(fx.utterance);
      if (fb.intent === fx.expected.intent) fbIntentOk++;
      fbLatencies.push(performance.now() - ft0);
    }

    const cat = categoryStats.get(fx.category) ?? { total: 0, passed: 0 };
    cat.total++;
    if (errors.length === 0) {
      cat.passed++;
      semanticOk++;
    } else {
      failures.push({ id: fx.id, category: fx.category, reasons: errors });
    }
    categoryStats.set(fx.category, cat);
  }

  const estVoiceCostMicros = estimateCostPkrMicros(
    "gemini-3.5-flash-lite",
    { input_tokens: 1_650, output_tokens: 300, cached_input_tokens: 0 },
    280,
  ).costPkrMicros;

  return {
    mode: useLive ? "live_model" : "synthetic_offline",
    provenance: "synthetic",
    real_consented_samples: 0,
    total_cases: fixtures.length,
    metrics: {
      exact_intent_accuracy: ratio(intentOk, fixtures.length),
      customer_extraction_accuracy: ratio(customerOk, customerTotal),
      item_extraction_accuracy: ratio(itemOk, itemTotal),
      quantity_accuracy: ratio(qtyOk, qtyTotal),
      amount_accuracy: ratio(amountOk, amountTotal),
      discount_accuracy: ratio(discountOk, discountTotal),
      cash_credit_accuracy: ratio(cashCreditOk, cashCreditTotal),
      exact_semantic_transaction_accuracy: ratio(semanticOk, fixtures.length),
      unsafe_tier1_rate: ratio(unsafeTier1, safetyTotal),
      fallback_intent_accuracy: ratio(fbIntentOk, fbTested),
      local_pipeline_latency_p50_ms: percentile(latencies, 50),
      local_pipeline_latency_p95_ms: percentile(latencies, 95),
      fallback_latency_p95_ms: percentile(fbLatencies, 95),
      model_failure_rate: useLive ? ratio(modelFailures, fixtures.length) : null,
      estimated_cost_per_call_pkr: Math.round((estVoiceCostMicros / 1_000_000) * 10000) / 10000,
      cost_basis: "estimated_synthetic_5s_clip",
    },
    by_category: Object.fromEntries([...categoryStats.entries()].map(([k, v]) => [k, { ...v, accuracy: ratio(v.passed, v.total) }])),
    failures,
  };
}

function evaluateParchi() {
  const file = path.resolve(process.cwd(), "tests/fixtures/ai/parchi/golden-parchi-fixtures.json");
  const fixtures = JSON.parse(readFileSync(file, "utf8")) as ParchiFixture[];
  const latencies: number[] = [];
  const categoryStats = new Map<string, { total: number; passed: number }>();
  const failures: Array<{ id: string; category: string; reasons: string[] }> = [];

  let lineExpected = 0;
  let lineDetected = 0;
  let productOk = 0;
  let qtyTotal = 0;
  let qtyOk = 0;
  let unitTotal = 0;
  let unitOk = 0;
  let rateTotal = 0;
  let rateOk = 0;
  let lineTotalExpected = 0;
  let lineTotalOk = 0;
  let grandTotalExpected = 0;
  let grandTotalOk = 0;
  let mismatchExpected = 0;
  let mismatchDetected = 0;
  let reviewCount = 0;
  let writeToolsViolation = 0;

  for (const fx of fixtures) {
    const t0 = performance.now();
    const checked = PARCHI_OCR_ZOD_SCHEMA.parse(fx.ocr);
    const result = interpretParchiOcr(checked, catalog.products, "gemini-3.5-flash-lite", 0);
    latencies.push(performance.now() - t0);

    const errors: string[] = [];
    if (result.write_tools_bound !== 0) {
      writeToolsViolation++;
      errors.push("write_tools_bound!=0");
    }
    if (result.manual_review_required) reviewCount++;
    if (result.manual_review_required !== fx.expected.manual_review_required) {
      errors.push(`manual_review=${result.manual_review_required}!=expected:${fx.expected.manual_review_required}`);
    }
    if (result.math_check.passed !== fx.expected.math_passed) {
      errors.push(`math_passed=${result.math_check.passed}!=expected:${fx.expected.math_passed}`);
    }

    lineExpected += fx.expected.line_count;
    lineDetected += Math.min(fx.expected.line_count, result.lines.length);

    if (fx.expected.extracted_total_paisa !== undefined || fx.expected.computed_total_paisa !== undefined) {
      grandTotalExpected++;
      const extOk = fx.expected.extracted_total_paisa === undefined || result.math_check.extracted_total_paisa === fx.expected.extracted_total_paisa;
      const compOk = fx.expected.computed_total_paisa === undefined || result.math_check.computed_total_paisa === fx.expected.computed_total_paisa;
      if (extOk && compOk) grandTotalOk++;
      else errors.push(`grand_total:ext=${result.math_check.extracted_total_paisa},comp=${result.math_check.computed_total_paisa}`);
    }

    if (!fx.expected.math_passed) {
      mismatchExpected++;
      if (!result.math_check.passed) mismatchDetected++;
    }

    fx.expected.lines.forEach((exp, idx) => {
      const actual = result.lines[idx];
      if (!actual) {
        errors.push(`missing_line[${idx}]`);
        return;
      }
      if (exp.product_id || exp.match_status) {
        const ok = (exp.product_id ? actual.product_id === exp.product_id : true)
          && (exp.match_status ? actual.match_status === exp.match_status : true);
        if (ok) productOk++;
        else errors.push(`product[${idx}]=${actual.product_id ?? actual.match_status}`);
      }
      if ("qty_base_units" in exp) {
        qtyTotal++;
        if (actual.qty_base_units === exp.qty_base_units) qtyOk++;
        else errors.push(`qty[${idx}]=${actual.qty_base_units}`);
      }
      if ("base_unit" in exp || "conversion_unresolved" in exp) {
        unitTotal++;
        const baseOk = exp.base_unit === undefined || actual.base_unit === exp.base_unit;
        const convOk = exp.conversion_unresolved === undefined || actual.conversion_unresolved === exp.conversion_unresolved;
        if (baseOk && convOk) unitOk++;
        else errors.push(`unit[${idx}]=${actual.base_unit}/${actual.conversion_unresolved}`);
      }
      if ("rate_paisa" in exp) {
        rateTotal++;
        if (actual.rate_paisa === exp.rate_paisa) rateOk++;
        else errors.push(`rate[${idx}]=${actual.rate_paisa}`);
      }
      if ("line_total_paisa" in exp) {
        lineTotalExpected++;
        if (actual.line_total_paisa === exp.line_total_paisa) lineTotalOk++;
        else errors.push(`line_total[${idx}]=${actual.line_total_paisa}`);
      }
      if (exp.issues_include) {
        for (const issue of exp.issues_include) {
          if (!actual.issues.includes(issue as never)) errors.push(`missing_issue[${idx}]:${issue}`);
        }
      }
    });

    const cat = categoryStats.get(fx.category) ?? { total: 0, passed: 0 };
    cat.total++;
    if (errors.length === 0) cat.passed++;
    else failures.push({ id: fx.id, category: fx.category, reasons: errors });
    categoryStats.set(fx.category, cat);
  }

  const estParchiCostMicros = estimateCostPkrMicros(
    "gemini-3.5-flash-lite",
    { input_tokens: 2_500, output_tokens: 450, cached_input_tokens: 0 },
    280,
  ).costPkrMicros;

  return {
    mode: "synthetic_offline",
    provenance: "synthetic",
    real_consented_images: 0,
    total_cases: fixtures.length,
    metrics: {
      line_detection_recall: ratio(lineDetected, lineExpected),
      product_name_accuracy: ratio(productOk, lineExpected),
      quantity_accuracy: ratio(qtyOk, qtyTotal),
      unit_accuracy: ratio(unitOk, unitTotal),
      rate_accuracy: ratio(rateOk, rateTotal),
      line_total_accuracy: ratio(lineTotalOk, lineTotalExpected),
      grand_total_accuracy: ratio(grandTotalOk, grandTotalExpected),
      mismatch_detection_rate: ratio(mismatchDetected, mismatchExpected),
      manual_review_rate: ratio(reviewCount, fixtures.length),
      write_tools_violations: writeToolsViolation,
      local_pipeline_latency_p50_ms: percentile(latencies, 50),
      local_pipeline_latency_p95_ms: percentile(latencies, 95),
      estimated_cost_per_image_pkr: Math.round((estParchiCostMicros / 1_000_000) * 10000) / 10000,
      cost_basis: "estimated_synthetic_1280px_parchi",
    },
    by_category: Object.fromEntries([...categoryStats.entries()].map(([k, v]) => [k, { ...v, accuracy: ratio(v.passed, v.total) }])),
    failures,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const wantJson = args.has("--json");
  const wantLive = args.has("--live");
  const runVoice = args.has("--voice") || args.has("--all") || (!args.has("--voice") && !args.has("--parchi"));
  const runParchi = args.has("--parchi") || args.has("--all") || (!args.has("--voice") && !args.has("--parchi"));

  if (wantLive && !process.env.GEMINI_API_KEY) {
    console.error("Error: --live evaluation requires GEMINI_API_KEY.");
    process.exit(2);
  }

  const report: Record<string, unknown> = {
    generated_at: new Date().toISOString(),
    provenance_note: "All bundled evaluation fixtures are synthetic. Real consented audio/parchi field validation is pending.",
  };

  let passed = true;
  if (runVoice) {
    const voice = await evaluateVoice(wantLive);
    report.voice = voice;
    if (voice.metrics.unsafe_tier1_rate > 0 || voice.metrics.exact_semantic_transaction_accuracy < 1) passed = false;
  }
  if (runParchi) {
    const parchi = evaluateParchi();
    report.parchi = parchi;
    if (parchi.metrics.write_tools_violations > 0 || parchi.metrics.mismatch_detection_rate < 1 || parchi.failures.length > 0) {
      passed = false;
    }
  }
  report.status = passed ? "PASS" : "FAIL";

  if (wantJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\nDukaanOS P2 AI Evaluation Report (synthetic offline fixtures)\n");
    if (report.voice) {
      const v = report.voice as Awaited<ReturnType<typeof evaluateVoice>>;
      console.log(`Voice (${v.total_cases} cases · ${v.mode}):`);
      console.log(`  Intent=${v.metrics.exact_intent_accuracy} Customer=${v.metrics.customer_extraction_accuracy} Items=${v.metrics.item_extraction_accuracy} Qty=${v.metrics.quantity_accuracy} Amount=${v.metrics.amount_accuracy} Discount=${v.metrics.discount_accuracy} Cash/Credit=${v.metrics.cash_credit_accuracy}`);
      console.log(`  Semantic=${v.metrics.exact_semantic_transaction_accuracy} UnsafeTier1=${v.metrics.unsafe_tier1_rate} FallbackIntent=${v.metrics.fallback_intent_accuracy} p50=${v.metrics.local_pipeline_latency_p50_ms}ms p95=${v.metrics.local_pipeline_latency_p95_ms}ms EstCost=Rs.${v.metrics.estimated_cost_per_call_pkr}`);
      if (v.failures.length) console.log("  Voice failures:", v.failures);
    }
    if (report.parchi) {
      const p = report.parchi as ReturnType<typeof evaluateParchi>;
      console.log(`Parchi (${p.total_cases} cases · ${p.mode}):`);
      console.log(`  LineRecall=${p.metrics.line_detection_recall} Product=${p.metrics.product_name_accuracy} Qty=${p.metrics.quantity_accuracy} Unit=${p.metrics.unit_accuracy} Rate=${p.metrics.rate_accuracy} LineTotal=${p.metrics.line_total_accuracy} GrandTotal=${p.metrics.grand_total_accuracy}`);
      console.log(`  MismatchDetect=${p.metrics.mismatch_detection_rate} ManualReview=${p.metrics.manual_review_rate} WriteToolsViolations=${p.metrics.write_tools_violations} p50=${p.metrics.local_pipeline_latency_p50_ms}ms p95=${p.metrics.local_pipeline_latency_p95_ms}ms EstCost=Rs.${p.metrics.estimated_cost_per_image_pkr}`);
      if (p.failures.length) console.log("  Parchi failures:", p.failures);
    }
    console.log(`\nOverall Status: ${report.status}\n`);
  }

  process.exit(passed ? 0 : 1);
}

void main();
