import { describe, expect, it } from "vitest";
import { AUDIO_MIME_TYPES, audioContentMatches, IMAGE_MIME_TYPES, imageContentMatches, readMultipartLimited } from "@/lib/server/media-validation";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("AI media signature validation", () => {
  it("allows only explicitly supported audio formats with matching headers", () => {
    expect(AUDIO_MIME_TYPES).toContain("audio/webm");
    expect(audioContentMatches("audio/webm", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00]))).toBe(true);
    expect(audioContentMatches("audio/ogg", bytes("OggS\u0000"))).toBe(true);
    expect(audioContentMatches("audio/wav", bytes("RIFF1234WAVE"))).toBe(true);
    expect(audioContentMatches("audio/mp4", bytes("1234ftypisom"))).toBe(true);
    expect(audioContentMatches("audio/mpeg", bytes("ID3audio"))).toBe(true);
    expect(audioContentMatches("audio/flac", bytes("fLaCdata"))).toBe(true);
    expect(audioContentMatches("audio/webm", bytes("OggS"))).toBe(false);
    expect(audioContentMatches("audio/unknown", bytes("data"))).toBe(false);
  });

  it("rejects active or mislabeled image formats", () => {
    expect(IMAGE_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(imageContentMatches("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0x00]))).toBe(true);
    expect(imageContentMatches("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(imageContentMatches("image/webp", bytes("RIFF1234WEBP"))).toBe(true);
    expect(imageContentMatches("image/jpeg", bytes("<svg>bad</svg>"))).toBe(false);
    expect(imageContentMatches("image/gif", bytes("GIF89a"))).toBe(false);
  });

  it("stops oversized chunked multipart bodies before parsing or buffering them", async () => {
    const request = new Request("https://example.test/api/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=fixture" },
      body: new Blob(["x".repeat(2_000)]),
    });
    await expect(readMultipartLimited(request, 1_000)).resolves.toBeNull();
  });

  it("re-parses a bounded multipart body using only its original boundary header", async () => {
    const form = new FormData();
    form.set("text", "voice check");
    form.set("audio", new Blob(["fixture"]), "clip.webm");
    const request = new Request("https://example.test/api/upload", { method: "POST", body: form });
    const parsed = await readMultipartLimited(request, 10_000);
    expect(parsed?.get("text")).toBe("voice check");
    expect(parsed?.get("audio")).toBeInstanceOf(File);
  });
});
