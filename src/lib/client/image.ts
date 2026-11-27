"use client";

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  lowRes: boolean;
  dataUrl: string;
  /** Local-only preview of the untouched source image; never uploaded. */
  originalPreviewUrl: string;
}

/** Downscale to ≤1280px JPEG (q=0.75) so uploads stay well under the 4.5 MB serverless cap. Optional contrast boost for faded/dim slips. */
export async function prepareImage(file: Blob, maxSide = 1280, quality = 0.75, enhance = false): Promise<PreparedImage> {
  if (!Number.isInteger(maxSide) || maxSide < 256 || maxSide > 4096) throw new RangeError("maxSide must be between 256 and 4096 pixels");
  if (!Number.isFinite(quality) || quality < 0.4 || quality > 1) throw new RangeError("quality must be between 0.4 and 1");
  const originalPreviewUrl = URL.createObjectURL(file);
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bmp.width < 1 || bmp.height < 1 || bmp.width * bmp.height > 100_000_000) throw new Error("Image dimensions are invalid or too large to process safely");
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image canvas is unavailable");
    if (enhance && "filter" in ctx) {
      ctx.filter = "contrast(1.38) brightness(1.06) grayscale(0.6)";
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Image encoding failed"))), "image/jpeg", quality));
    return {
      blob,
      width: w,
      height: h,
      originalWidth: bmp.width,
      originalHeight: bmp.height,
      lowRes: Math.max(bmp.width, bmp.height) < 800,
      dataUrl: canvas.toDataURL("image/jpeg", 0.5),
      originalPreviewUrl,
    };
  } catch (error) {
    URL.revokeObjectURL(originalPreviewUrl);
    throw error;
  } finally {
    bmp?.close();
  }
}
