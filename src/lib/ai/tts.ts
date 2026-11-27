/**
 * F-12 query-only Urdu TTS (reads Pulse / answers aloud). Uses AI_TTS_MODEL; returns a WAV.
 * The PWA falls back to the browser's speechSynthesis (ur-PK) if this is unavailable or >2 s.
 */
import { env } from "@/lib/env";
import { generateContentOnce } from "./models";

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const URDU_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

function toUrduDigits(input: string): string {
  return input.replace(/\d/g, (d) => URDU_DIGITS[Number(d)] ?? d);
}

function normalizeUrduSpeechText(text: string): string {
  const cleaned = text
    .replace(/\bRs\.?\s*/gi, "روپے ")
    .replace(/\brupay\b/gi, "روپے")
    .replace(/\budhaar\b/gi, "ادھار")
    .replace(/\bcash\b/gi, "نقد")
    .replace(/\bwasooli\b/gi, "وصولی")
    .replace(/\bkhata\b/gi, "کھاتہ")
    .replace(/\bsales?\b/gi, "فروخت")
    .replace(/\bitems?\b/gi, "اشیاء")
    .replace(/\bbill\b/gi, "بل")
    .replace(/\s+/g, " ")
    .trim();
  // Use Urdu-Indic digits so the voice stays in Pakistani Urdu cadence rather than switching to English for numbers.
  return toUrduDigits(cleaned);
}

export async function synthesizeUrdu(text: string, shopId: string): Promise<{ wav: Buffer; model: string; latency_ms: number }> {
  const cleanText = normalizeUrduSpeechText(text);
  const call = await generateContentOnce(env.ttsModel(), {
    // 3.8 TTS treats `text` as a verbatim transcript — an inline "read this softly" prefix gets spoken
    // aloud, so only the words to say go here (tone comes from the voice choice).
    contents: [{ role: "user", parts: [{ text: cleanText }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    },
  }, 8000, { shopId, kind: "tts" });
  const part = call.response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const data = part?.inlineData?.data;
  if (!data) throw new Error("TTS returned no audio");
  const mime = part?.inlineData?.mimeType ?? "audio/L16;rate=24000";
  const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
  const buf = Buffer.from(data, "base64");
  const wav = /wav/i.test(mime) ? buf : pcmToWav(buf, rate);
  return { wav, model: call.model, latency_ms: call.latency_ms };
}
