"use client";

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  lowRes: boolean;
  dataUrl: string;
}

/** Downscale to ≤1280px JPEG (q=0.75) so uploads stay well under the 4.5 MB serverless cap. */
export async function prepareImage(file: Blob, maxSide = 1280, quality = 0.75): Promise<PreparedImage> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), "image/jpeg", quality));
  return {
    blob,
    width: w,
    height: h,
    originalWidth: bmp.width,
    originalHeight: bmp.height,
    lowRes: Math.max(bmp.width, bmp.height) < 800,
    dataUrl: canvas.toDataURL("image/jpeg", 0.5),
  };
}
