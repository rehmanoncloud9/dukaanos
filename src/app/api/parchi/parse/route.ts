import { parseParchi } from "@/lib/ai/parchi";
import { ApiError, handle, ok } from "@/lib/api/http";
import { loadCatalog } from "@/lib/api/shop";
import { shopContext } from "@/lib/supabase/server";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

/**
 * POST /api/parchi/parse — ZERO write tools. Reads a crinkled wholesale parchi and returns an
 * editable review sheet (line math check, bill-sum check, matched | new_sku). Nothing is saved
 * until the shopkeeper taps Restock Commit → /api/transactions/purchase.
 */
export const POST = handle(async (req: Request) => {
  const t0 = Date.now();
  const { sb, shopId } = shopContext(req);
  const form = await req.formData();
  const file = form.get("image");
  if (!file || typeof file === "string") throw new ApiError("BAD_REQUEST", "image file required");
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/")) throw new ApiError("UNSUPPORTED_MEDIA", `Expected image/*, got "${mime || "unknown"}"`);
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError("IMAGE_TOO_LARGE", `Photo is ${(file.size / 1e6).toFixed(1)} MB (max 4.5 MB)`);
  const [{ catalog }, bytes] = await Promise.all([loadCatalog(sb, shopId), file.arrayBuffer()]);
  const result = await parseParchi({ base64: Buffer.from(bytes).toString("base64"), mimeType: mime.split(";")[0], products: catalog.products });
  return ok({ ...result, api_ms: Date.now() - t0 });
});
