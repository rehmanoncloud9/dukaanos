import {
  describeShopSubtitle,
  isDeleteConfirmationValid,
  isHealthPayload,
  resolveWebAppUrl,
} from "@/features/settings/logic";

describe("Settings data-rights and delete-account guards", () => {
  test("accepts DELETE (case-insensitive) and Urdu حذف confirmation only", () => {
    expect(isDeleteConfirmationValid("DELETE")).toBe(true);
    expect(isDeleteConfirmationValid(" delete ")).toBe(true);
    expect(isDeleteConfirmationValid("حذف")).toBe(true);
    expect(isDeleteConfirmationValid("")).toBe(false);
    expect(isDeleteConfirmationValid("DEL")).toBe(false);
    expect(isDeleteConfirmationValid("yes")).toBe(false);
  });

  test("resolves legal and web fallback URLs without double slashes", () => {
    expect(resolveWebAppUrl("https://dukaanos.pk/", "/privacy")).toBe(
      "https://dukaanos.pk/privacy",
    );
    expect(resolveWebAppUrl("https://dukaanos.pk", "/delete-account")).toBe(
      "https://dukaanos.pk/delete-account",
    );
    expect(resolveWebAppUrl("", "/terms")).toBeNull();
  });

  test("formats shop role subtitle accurately", () => {
    expect(
      describeShopSubtitle({
        id: "s1",
        name: "Stage",
        city: "Lahore",
        role: "owner",
        is_demo_shop: true,
        is_stage_shop: true,
      }),
    ).toBe("Stage shop (protected) · owner");

    expect(
      describeShopSubtitle({
        id: "s2",
        name: "Sandbox",
        city: null,
        role: "owner",
        is_demo_shop: true,
        is_stage_shop: false,
      }),
    ).toBe("Isolated judge sandbox · owner");
  });

  test("guards health payload shape", () => {
    expect(isHealthPayload({ ok: true })).toBe(true);
    expect(isHealthPayload(null)).toBe(false);
    expect(isHealthPayload({ status: "ok" })).toBe(false);
  });
});
