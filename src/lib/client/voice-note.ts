"use client";
/**
 * Wasooli without asking: render the polite reminder as a real audio file (free-tier Gemini TTS via
 * /api/system/tts) and hand it to the phone's share sheet → WhatsApp voice-note style. Customers who
 * cannot read still hear exactly what they owe, in the Munshi's voice — the shopkeeper never has to.
 */
import { api } from "./api";
import { shareOrDownload } from "./canvas";

export async function makeVoiceNote(text: string): Promise<Blob> {
  const res = await api<Response>("/api/system/tts", { json: { text: text.slice(0, 400) }, raw: true, timeoutMs: 15_000 });
  const blob = await res.blob();
  if (!blob.size) throw new Error("TTS returned no audio");
  return blob.type ? blob : new Blob([blob], { type: "audio/wav" });
}

/** Returns how the note left the phone; throws when TTS is unavailable (caller falls back to text). */
export async function sendVoiceNote(text: string, customerName: string, caption?: string): Promise<"shared" | "downloaded"> {
  const blob = await makeVoiceNote(text);
  const safe = customerName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 30) || "customer";
  return shareOrDownload(blob, `yaad-dihani-${safe}.wav`, caption);
}
