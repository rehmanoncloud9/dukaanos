"use client";

import { api, isOffline } from "./api";

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
let speakingNow = false;
let ttsStartedAt = 0;
let speechGen = 0;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
const TTS_MAX_HOLD_MS = 12_000;

function clearWatchdog(): void {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function setSpeakingState(val: boolean): void {
  speakingNow = val;
  ttsStartedAt = val ? Date.now() : 0;
  clearWatchdog();
  if (val) {
    watchdogTimer = setTimeout(() => {
      if (speakingNow) setSpeakingState(false);
    }, TTS_MAX_HOLD_MS);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dukaan:tts-state", { detail: { speaking: val } }));
  }
}

export function isTtsSpeaking(): boolean {
  if (speakingNow) {
    if (Date.now() - ttsStartedAt > TTS_MAX_HOLD_MS) {
      setSpeakingState(false);
      return false;
    }
    return true;
  }
  if (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking && ttsStartedAt > 0 && Date.now() - ttsStartedAt < TTS_MAX_HOLD_MS) {
    return true;
  }
  return false;
}

/** Immediately interrupt any active Urdu TTS audio (used by Walkie-Talkie barge-in). */
export function stopSpeaking(): void {
  speechGen += 1;
  if (activeAudio) {
    try { activeAudio.pause(); } catch { /* ignore */ }
    activeAudio = null;
  }
  if (typeof speechSynthesis !== "undefined") {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  if (speakingNow) setSpeakingState(false);
}

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
        if (audioCache.size >= 80) {
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

/** Return a shareable server-generated Urdu audio file when connected. */
export async function getSpeakAudioBlob(text: string, budgetMs = 7000): Promise<Blob | null> {
  if (isOffline() || !text.trim()) return null;
  try {
    return await fetchTtsBlob(text.trim(), budgetMs);
  } catch {
    return null;
  }
}

/** Silently pre-warm Urdu audio in memory so Suniye plays in 0 ms when tapped. */
export function prefetchSpeak(text: string): void {
  if (typeof window === "undefined" || isOffline() || !text.trim()) return;
  void fetchTtsBlob(text, 7000).catch(() => undefined);
}

async function playBlob(blob: Blob, gen: number): Promise<void> {
  if (gen !== speechGen) return;
  if (activeAudio) {
    try { activeAudio.pause(); } catch { /* ignore */ }
    activeAudio = null;
  }
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  activeAudio = audio;
  setSpeakingState(true);
  const cleanup = () => {
    URL.revokeObjectURL(url);
    if (activeAudio === audio) activeAudio = null;
    if (gen === speechGen) setSpeakingState(false);
  };
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  try {
    await audio.play();
  } catch (e) {
    cleanup();
    throw e;
  }
}

async function speakBrowser(text: string, gen: number): Promise<"browser" | "none"> {
  if (typeof speechSynthesis === "undefined" || gen !== speechGen) return "none";
  const u = new SpeechSynthesisUtterance(text);
  u.voice = await pickUrduVoice();
  if (gen !== speechGen) return "none";
  u.lang = u.voice?.lang ?? "ur-PK";
  u.rate = 0.92;
  u.pitch = 0.98;
  setSpeakingState(true);
  const done = () => {
    if (gen === speechGen) setSpeakingState(false);
  };
  u.onend = done;
  u.onerror = done;
  try {
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    done();
    return "none";
  }
  return "browser";
}

/** F-12 query-only readout: server ur-PK neural TTS (with blob cache), else browser speechSynthesis (ur-PK). */
export async function speak(text: string, budgetMs = 7000): Promise<"tts" | "browser" | "none"> {
  const key = text.trim();
  if (!key) return "none";
  const gen = ++speechGen;
  if (activeAudio) {
    try { activeAudio.pause(); } catch { /* ignore */ }
    activeAudio = null;
  }
  if (typeof speechSynthesis !== "undefined") {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
  if (isOffline()) {
    return speakBrowser(key, gen);
  }
  try {
    const blob = await fetchTtsBlob(key, budgetMs);
    if (gen !== speechGen) return "none";
    await playBlob(blob, gen);
    return "tts";
  } catch (e) {
    if (gen !== speechGen) return "none";
    if (!(e instanceof Error && e.name === "AbortError")) {
      audioCache.delete(key);
    }
    return speakBrowser(key, gen);
  }
}
