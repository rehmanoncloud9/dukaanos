import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("DukaanOS Web PWA E2E", () => {
  test("public legal, verify, and 404 routes pass axe with zero serious/critical issues", async ({ page }) => {
    for (const route of ["/privacy", "/terms", "/delete-account", "/verify", "/non-existent-route-404"]) {
      await page.goto(route);
      await expect(page.locator("main")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, `Axe violations on ${route}: ${JSON.stringify(serious)}`).toEqual([]);
    }
  });

  test("splash page loads cleanly at 390px and passes axe", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Try Live Demo Shop/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious).toEqual([]);
  });

  test("full kiryana counter flow: sandbox -> Act 1 -> X-Ray Replay -> Offline -> Pulse -> Khata -> Passport -> /verify -> Parchi -> Tier-1 Undo", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
    await page.goto("/?xray=1");

    // 1. Sandbox sign-in
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/demo/sandbox") && r.request().method() === "POST"),
      page.getByRole("button", { name: /Try Live Demo Shop/i }).click(),
    ]);
    await expect(page.getByText(/Today cash/i)).toBeVisible({ timeout: 45_000 }).catch((e) => {
      throw new Error(`${e.message}\nNetwork/Page errors: ${errors.join("; ")}`);
    });

    // 2. Typed Act-1 utterance -> Tier-2 Review Sheet -> 3-Ali chips -> Confirm
    await page.getByRole("button", { name: /Type instead/i }).click();
    const input = page.getByPlaceholder(/Type Urdu \/ Roman/i);
    await input.fill("Chhote Ali ko dedh pao cheeni, 250 ka khula oil, 30 rupay chhor do, 400 cash diya baqi khate mein");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText(/Review Entry/i)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("dialog").getByRole("button", { name: /Chhote Ali/i }).click();
    await page.getByRole("button", { name: /Confirm & Save/i }).click();

    // Receipt sheet -> Done -> X-Ray Replay Test (0 Dupes)
    await expect(page.getByRole("button", { name: /Done/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Done/i }).click();

    await page.getByRole("button", { name: /X-Ray/i }).click();
    await expect(page.getByText(/X-Ray Inspector/i)).toBeVisible();
    await page.getByRole("button", { name: /Replay Test/i }).click();
    await expect(page.getByText(/0 Dupes/i)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    // 3. Simulate Offline -> typed sale queued -> reconnect -> synced
    await page.getByRole("button", { name: /Bismillah Kiryana/i }).click();
    await page.getByRole("button", { name: /Simulate Offline/i }).click();
    await page.keyboard.press("Escape");

    await input.fill("Ek kilo cheeni cash");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Internet band hai/i)).toBeVisible();

    await page.getByRole("button", { name: /Reconnect/i }).click();
    // If model fell back to Tier-2 rule parse, confirm the queued review sheet; otherwise Tier-1 auto-commits
    const reviewConfirm = page.getByRole("button", { name: /Confirm & Save/i });
    const hasReview = await reviewConfirm.waitFor({ state: "visible", timeout: 12_000 }).then(() => true).catch(() => false);
    if (hasReview) {
      await reviewConfirm.click();
      const doneBtn = page.getByRole("button", { name: /^Done$/i });
      if (await doneBtn.waitFor({ state: "visible", timeout: 10_000 }).then(() => true).catch(() => false)) {
        await doneBtn.click();
      }
    }
    // Close X-Ray if Judge Mode auto-opened it
    const xrayClose = page.getByRole("button", { name: "Close" }).last();
    if (await xrayClose.isVisible().catch(() => false)) await page.keyboard.press("Escape");
    await expect(page.getByText(/Internet band hai/i)).toBeHidden({ timeout: 25_000 });

    // 4. Pulse via "Subah ka hisaab batao"
    await input.fill("Subah ka hisaab batao");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Munshi Pulse/i)).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");

    // 5. Khata Wasooli + SMEConnect Passport + /verify valid & tamper invalid
    await page.getByRole("tab", { name: /Khata/i }).click();
    await expect(page.getByText(/Total receivable/i)).toBeVisible();
    await page.getByRole("button", { name: /SMEConnect/i }).click();
    await expect(page.getByText(/Ed25519 VERIFIED/i)).toBeVisible({ timeout: 20_000 });

    const [verifyPage] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("link", { name: /Simulate Judge Phone Scan/i }).click(),
    ]);
    await verifyPage.waitForLoadState();
    await expect(verifyPage.getByText(/Signature valid/i)).toBeVisible();
    await verifyPage.getByRole("button", { name: /Tamper test/i }).click();
    await expect(verifyPage.getByText(/Invalid/i)).toBeVisible();
    await verifyPage.close();
    await page.getByRole("button", { name: "Done" }).click();

    // 6. Maal -> Parchi staged sample -> Restock
    await page.getByRole("tab", { name: /Maal/i }).click();
    await page.getByRole("button", { name: /Scan Parchi/i }).click();
    await page.getByRole("button", { name: /1-tap staged field sample/i }).click();
    await expect(page.getByRole("button", { name: /Restock Commit/i })).toBeVisible({ timeout: 35_000 }).catch((e) => {
      throw new Error(`${e.message}\nNetwork/Page errors: ${errors.join("; ")}`);
    });
    const useComputed = page.getByRole("button", { name: /Use Rs\./i }).first();
    if (await useComputed.isVisible().catch(() => false)) await useComputed.click();
    const ackTotal = page.getByRole("button", { name: /Confirm total/i }).first();
    if (await ackTotal.isVisible().catch(() => false)) await ackTotal.click();
    const restockBtn = page.getByRole("button", { name: /Restock Commit/i });
    if (await restockBtn.isEnabled()) {
      await restockBtn.click();
      await expect(restockBtn).toBeHidden({ timeout: 15_000 });
    } else {
      await page.keyboard.press("Escape");
    }

    // 7. Tier-1 sale + 5s Undo
    await page.getByRole("tab", { name: /Munshi/i }).click();
    await input.fill("2 packet Lays cash");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "UNDO" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "UNDO" }).click();
    await expect(page.getByText(/Undone/i)).toBeVisible({ timeout: 15_000 });
  });
});
