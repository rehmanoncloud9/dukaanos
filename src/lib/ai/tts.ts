/**
 * F-12 query-only Urdu TTS (reads Pulse / Khata / answers aloud).
 * Primary: Microsoft Edge free neural Pakistani Urdu voice (`ur-PK-AsadNeural`, MP3, ~300-600ms, zero billing).
 * Fallback: AI_TTS_MODEL (WAV) → client browser speechSynthesis (ur-PK).
 */
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { env } from "@/lib/env";
import { generateContentOnce } from "./models";

const URDU_ONES = [
  "صفر", "ایک", "دو", "تین", "چار", "پانچ", "چھ", "سات", "آٹھ", "نو",
  "دس", "گیارہ", "بارہ", "تیرہ", "چودہ", "پندرہ", "سولہ", "سترہ", "اٹھارہ", "انیس",
  "بیس", "اکیس", "بائیس", "تئیس", "چوبیس", "پچیس", "چھبیس", "ستائیس", "اٹھائیس", "انتیس",
  "تیس", "اکتیس", "بتیس", "تینتیس", "چونتیس", "پینتیس", "چھتیس", "سینتیس", "اڑتیس", "انتالیس",
  "چالیس", "اکتالیس", "بیالیس", "تینتالیس", "چوالیس", "پینتالیس", "چھیالیس", "سینتالیس", "اڑتالیس", "انچاس",
  "پچاس", "اکیاون", "باون", "ترپن", "چون", "پچپن", "چھپن", "ستاون", "اٹھاون", "انسٹھ",
  "ساٹھ", "اکسٹھ", "باسٹھ", "ترسٹھ", "چونسٹھ", "پینسٹھ", "چھیاسٹھ", "سڑسٹھ", "اڑسٹھ", "انہتر",
  "ستر", "اکہتر", "بہتر", "تہتر", "چوہتر", "پچہتر", "چھہتر", "ستتر", "اٹھتر", "اناسی",
  "اسی", "اکیاسی", "بیاسی", "تراسی", "چوراسی", "پچاسی", "چھیاسی", "ستاسی", "اٹھاسی", "نواسی",
  "نوے", "اکانوے", "بانوے", "ترانوے", "چورانوے", "پچانوے", "چھیانوے", "ستانوے", "اٹھانوے", "ننانوے",
];

/** Convert a non-negative integer into natural Pakistani Urdu words (supports crores/lakhs). */
export function numberToUrduWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return String(n);
  const whole = Math.round(n);
  if (whole < 100) return URDU_ONES[whole] ?? String(whole);

  const parts: string[] = [];
  const crores = Math.floor(whole / 10_000_000);
  const lakhs = Math.floor((whole % 10_000_000) / 100_000);
  const thousands = Math.floor((whole % 100_000) / 1_000);
  const hundreds = Math.floor((whole % 1_000) / 100);
  const rem = whole % 100;

  if (crores > 0) parts.push(`${numberToUrduWords(crores)} کروڑ`);
  if (lakhs > 0) parts.push(`${numberToUrduWords(lakhs)} لاکھ`);
  if (thousands > 0) parts.push(`${numberToUrduWords(thousands)} ہزار`);
  if (hundreds > 0) parts.push(`${URDU_ONES[hundreds]} سو`);
  if (rem > 0) parts.push(URDU_ONES[rem]);
  return parts.join(" ");
}

/** Normalize mixed Roman/digits/currency into clean Urdu script for natural ur-PK pronunciation. */
export function normalizeUrduSpeechText(text: string): string {
  return text
    .replace(/\bRs\.?\s*/gi, "روپے ")
    .replace(/\brupay\b/gi, "روپے")
    .replace(/\budhaar\b/gi, "ادھار")
    .replace(/\bcash\b/gi, "نقد")
    .replace(/\bwasooli\b/gi, "وصولی")
    .replace(/\bkhata\b/gi, "کھاتہ")
    .replace(/\bsales?\b/gi, "فروخت")
    .replace(/\bitems?\b/gi, "اشیاء")
    .replace(/\bbill\b/gi, "بل")
    .replace(/\d[\d,]*/g, (raw) => {
      const val = Number(raw.replace(/,/g, ""));
      return Number.isSafeInteger(val) && val <= 999_999_999 ? numberToUrduWords(val) : raw;
    })
    .replace(/\s+/g, " ")
    .trim();
}

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

async function synthesizeEdgeUrdu(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 4000, synthesisTimeoutMs: 5000 });
  try {
    await tts.setMetadata("ur-PK-AsadNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text);
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error("Edge TTS returned empty audio");
    return buf;
  } finally {
    tts.close();
  }
}

export async function synthesizeUrdu(
  text: string,
  shopId: string,
): Promise<{ audio: Buffer; mimeType: "audio/mpeg" | "audio/wav"; model: string; latency_ms: number }> {
  const t0 = Date.now();
  const cleanText = normalizeUrduSpeechText(text);

  try {
    const mp3 = await synthesizeEdgeUrdu(cleanText);
    return { audio: mp3, mimeType: "audio/mpeg", model: "ur-PK-AsadNeural", latency_ms: Date.now() - t0 };
  } catch {
    // Fall back to configured free-tier Gemini TTS if Edge endpoint is unavailable.
  }

  const call = await generateContentOnce(env.ttsModel(), {
    // 3.8 TTS treats `text` as a verbatim transcript — only the words to say go here.
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
  return { audio: wav, mimeType: "audio/wav", model: call.model, latency_ms: call.latency_ms };
}
