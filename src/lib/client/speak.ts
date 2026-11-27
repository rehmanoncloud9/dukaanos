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
const inflight = new Map<string, Promise<Blob>>();
let activeAudio: HTMLAudioElement | null = null;

async function fetchTtsBlob(text: string, budgetMs: number): Promise<Blob> {
  const key = text.trim();
  const cached = audioCache.get(key);
  if (cached) return cached;

  let pending = inflight.get(key);
  if (!pending) {
    pending = Promise.race([
      api<Response>("/api/system/tts", { json: { text: key }, raw: true, timeoutMs: budgetMs + 500 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tts budget")), budgetMs)),
    ])
      .then((res) => res.blob())
      .then((blob) => {
        if (audioCache.size >= 30) {
          const oldest = audioCache.keys().next().value;
          if (oldest) audioCache.delete(oldest);
        }
        audioCache.set(key, blob);
        return blob;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return pending;
}

/** Silently pre-warm Urdu audio in memory so Suniye plays in 0 ms when tapped. */
export function prefetchSpeak(text: string): void {
  if (typeof window === "undefined" || !text.trim()) return;
  void fetchTtsBlob(text, 7000).catch(() => undefined);
}

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
  try {
    const blob = await fetchTtsBlob(key, budgetMs);
    await playBlob(blob);
    return "tts";
  } catch {
    audioCache.delete(key);
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
