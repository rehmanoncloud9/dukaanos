/** Content signatures and explicit media-type allowlists for AI uploads. */

export const AUDIO_MIME_TYPES = [
  "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/mpeg", "audio/mp3", "audio/flac",
] as const;

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Read multipart input incrementally and stop before buffering beyond its cap. */
export async function readMultipartLimited(req: Request, maxBytes: number): Promise<FormData | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive safe integer");
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!req.body) return new FormData();

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Blob(chunks as BlobPart[]);
  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return null;
  // Copy only the boundary-bearing media type. Original Content-Length and
  // transfer headers describe the consumed stream and must not be replayed.
  const copy = new Request(req.url, { method: "POST", headers: { "content-type": contentType }, body });
  return copy.formData();
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return bytes.length >= offset + text.length
    && text.split("").every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

/** Check actual container headers after the browser MIME prefix/allowlist check. */
export function audioContentMatches(mime: string, bytes: Uint8Array): boolean {
  switch (mime) {
    case "audio/webm": return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "audio/ogg": return asciiAt(bytes, 0, "OggS");
    case "audio/wav":
    case "audio/x-wav": return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WAVE");
    case "audio/mp4": return asciiAt(bytes, 4, "ftyp");
    case "audio/mpeg":
    case "audio/mp3": return asciiAt(bytes, 0, "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case "audio/flac": return asciiAt(bytes, 0, "fLaC");
    default: return false;
  }
}

/** Check JPEG, PNG, and WebP signatures; active formats such as SVG are rejected. */
export function imageContentMatches(mime: string, bytes: Uint8Array): boolean {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && asciiAt(bytes, 1, "PNG\r\n\u001a\n");
  if (mime === "image/webp") return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP");
  return false;
}
