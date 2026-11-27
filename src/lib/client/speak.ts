"use client";

import { api } from "./api";

async function pickUrduVoice(): Promise<SpeechSynthesisVoice | null> {
  let voices = speechSynthesis.getVoices();
  if (!voices.length) {
    voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const done = () => resolve(speechSynthesis.getVoices());
      speechSynthesis.addEventListener("voiceschanged", done, { once: true });
      setTimeout(done, 300);
    });
  }
  return (
    voices.find((v) => /ur(-|_)?PK/i.test(v.lang) && /asad|uzma|google|natural/i.test(v.name)) ??
    voices.find((v) => /ur(-|_)?PK/i.test(v.lang)) ??
    voices.find((v) => /^ur/i.test(v.lang)) ??
    voices.find((v) => /hi(-|_)?IN/i.test(v.lang)) ??
    null
  );
}

const audioCache = new Map<string, Blob>();
let activeAudio: HTMLAudioElement | null = null;

async function playBlob(blob: Blob): Promise<void> {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = null;
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  activeAudio = audio;
  audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
  await audio.play();
}

/** F-12 query-only readout: server ur-PK neural TTS (with blob cache), else browser speechSynthesis (ur-PK). */
export async function speak(text: string, budgetMs = 7000): Promise<"tts" | "browser" | "none"> {
  const key = text.trim();
  const cached = audioCache.get(key);
  if (cached) {
    try {
      await playBlob(cached);
      return "tts";
    } catch {
      audioCache.delete(key);
    }
  }
  try {
    const res = await Promise.race([
      api<Response>("/api/system/tts", { json: { text }, raw: true, timeoutMs: budgetMs + 500 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tts budget")), budgetMs)),
    ]);
    const blob = await res.blob();
    if (audioCache.size >= 30) {
      const oldest = audioCache.keys().next().value;
      if (oldest) audioCache.delete(oldest);
    }
    audioCache.set(key, blob);
    await playBlob(blob);
    return "tts";
  } catch {
    if (typeof speechSynthesis === "undefined") return "none";
    const u = new SpeechSynthesisUtterance(text);
    u.voice = await pickUrduVoice();
    u.lang = u.voice?.lang ?? "ur-PK";
    u.rate = 0.9;
    u.pitch = 0.98;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return "browser";
  }
}
