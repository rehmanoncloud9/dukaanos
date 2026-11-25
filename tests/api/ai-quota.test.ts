import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb, one } from "../helpers/pglite";

let db: PGlite;
let shopId: string;

beforeAll(async () => {
  db = await bootDb();
  shopId = (await one<{ id: string }>(db, "select id from public.shops where is_stage_shop")).id;
}, 120_000);

describe("AI quota reservation and settlement", () => {
  it("enforces a serialized per-shop cap and settles SDK token usage without double counting", async () => {
    const reserve = async (globalCap: number) => {
      const result = await db.query<{ allowed: boolean; reason: string | null }>(
        "select (r->>'allowed')::boolean as allowed, r->>'reason' as reason from (select public.consume_ai_quota($1::uuid, 'voice', 100, 20, 1, $2::bigint, 9000) r) q",
        [shopId, globalCap],
      );
      return result.rows[0];
    };

    expect(await reserve(1_000)).toMatchObject({ allowed: false, reason: "GLOBAL_CAP" });
    expect(await reserve(5_000_000_000)).toMatchObject({ allowed: true });
    expect(await reserve(5_000_000_000)).toMatchObject({ allowed: false, reason: "SHOP_CAP" });

    await db.query(
      "select public.record_ai_usage($1::uuid, 'voice', 120, 10, 5, 'gemini-3.5-flash-lite', 100, 20, 9000, 7500, 'sdk_usage')",
      [shopId],
    );
    const usage = await one<{
      calls: number;
      input_tokens: string;
      output_tokens: string;
      cached_input_tokens: string;
      est_cost_micros: string;
      reserved_cost_micros: string;
      model_usage: Record<string, { calls: number; input_tokens: number; output_tokens: number; cached_input_tokens: number }>;
    }>(db, "select calls, input_tokens, output_tokens, cached_input_tokens, est_cost_micros, reserved_cost_micros, model_usage from public.ai_usage where shop_id = $1 and kind = 'voice'", [shopId]);

    expect(usage.calls).toBe(1);
    expect(Number(usage.input_tokens)).toBe(120);
    expect(Number(usage.output_tokens)).toBe(10);
    expect(Number(usage.cached_input_tokens)).toBe(5);
    expect(Number(usage.est_cost_micros)).toBe(7500);
    expect(Number(usage.reserved_cost_micros)).toBe(0);
    expect(usage.model_usage["gemini-3.5-flash-lite"]).toMatchObject({
      calls: 1, input_tokens: 120, output_tokens: 10, cached_input_tokens: 5,
      est_cost_micros: 7500, cost_basis: "sdk_usage",
    });
  });
});
