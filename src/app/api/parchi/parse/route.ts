import { parseParchi } from "@/lib/ai/parchi";
import { ApiError, handle, ok } from "@/lib/api/http";
import { loadCatalog } from "@/lib/api/shop";
import { requireShopContext } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/ratelimit";
import { IMAGE_MIME_TYPES, imageContentMatches, readMultipartLimited } from "@/lib/server/media-validation";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 128 * 1024;

/**
 * POST /api/parchi/parse — ZERO write tools. Reads a crinkled wholesale parchi and returns an
 * editable review sheet (line math check, bill-sum check, matched | new_sku). Nothing is saved
 * until the shopkeeper taps Restock Commit → /api/transactions/purchase.
 */
export const POST = handle(async (req: Request) => {
  const t0 = Date.now();
  const { sb, shopId, userId } = await requireShopContext(req);
  await enforceRateLimit(`ai:parchi:${userId}`, 5, "1 minute");
  let parsed: FormData | null;
  try {
    parsed = await readMultipartLimited(req, MAX_IMAGE_BYTES + MAX_MULTIPART_OVERHEAD);
  } catch {
    throw new ApiError("BAD_REQUEST", "Malformed multipart image request");
  }
  if (!parsed) throw new ApiError("IMAGE_TOO_LARGE", "Request exceeds the 4.5 MB image limit");
  const form = parsed;
  const file = form.get("image");
  if (!file || typeof file === "string") throw new ApiError("BAD_REQUEST", "image file required");
  const mime = (file.type || "").toLowerCase();
  if (!mime.startsWith("image/")) throw new ApiError("UNSUPPORTED_MEDIA", `Expected image/*, got "${mime || "unknown"}"`);
  const mediaType = mime.split(";")[0].trim();
  if (!IMAGE_MIME_TYPES.some((supported) => supported === mediaType)) {
    throw new ApiError("UNSUPPORTED_MEDIA", "Supported image formats are JPEG, PNG, and WebP");
  }
  if (file.size === 0) throw new ApiError("BAD_REQUEST", "Image is empty");
  if (file.size > MAX_IMAGE_BYTES) throw new ApiError("IMAGE_TOO_LARGE", `Photo is ${(file.size / 1e6).toFixed(1)} MB (max 4.5 MB)`);
  const [{ catalog }, bytes] = await Promise.all([loadCatalog(sb, shopId), file.arrayBuffer()]);
  const mediaBytes = new Uint8Array(bytes);
  if (!imageContentMatches(mediaType, mediaBytes)) throw new ApiError("UNSUPPORTED_MEDIA", "Image contents do not match the declared format");
  const result = await parseParchi({ base64: Buffer.from(mediaBytes).toString("base64"), mimeType: mediaType, products: catalog.products, shopId });
  return ok({ ...result, api_ms: Date.now() - t0 });
});
