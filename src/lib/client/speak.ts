"use client";

import { api } from "./api";

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
    const voices = speechSynthesis.getVoices();
    u.voice = voices.find((v) => /ur(-|_)?PK/i.test(v.lang)) ?? voices.find((v) => /^ur/i.test(v.lang)) ?? voices.find((v) => /hi(-|_)?IN/i.test(v.lang)) ?? null;
    u.lang = u.voice?.lang ?? "ur-PK";
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return "browser";
  }
}
