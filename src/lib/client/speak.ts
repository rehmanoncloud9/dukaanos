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

/** F-12 query-only readout: server TTS if it answers within budget, else browser speechSynthesis (ur-PK). */
export async function speak(text: string, budgetMs = 2500): Promise<"tts" | "browser" | "none"> {
  try {
    const res = await Promise.race([
      api<Response>("/api/system/tts", { json: { text }, raw: true, timeoutMs: budgetMs + 500 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("tts budget")), budgetMs)),
    ]);
    const blob = await res.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    await audio.play();
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
