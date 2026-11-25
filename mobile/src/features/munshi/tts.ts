import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { apiClient } from "@/core/api/client";

let activePlayer: AudioPlayer | null = null;
let activeFile: File | null = null;

export function stopTtsPlayback(): void {
  try {
    activePlayer?.pause();
    activePlayer?.remove();
  } catch {
    // Ignore audio teardown failures.
  }
  activePlayer = null;
  try {
    if (activeFile?.exists) activeFile.delete();
  } catch {
    // Ignore file cleanup errors.
  }
  activeFile = null;
}

/**
 * Play Urdu TTS via /api/system/tts within the response budget.
 * Returns "tts" when server audio plays, or "text-only" on offline/timeout/error.
 */
export async function speakUrdu(text: string, shopId?: string, budgetMs = 2500): Promise<"tts" | "text-only"> {
  if (!text.trim()) return "text-only";
  stopTtsPlayback();
  try {
    const wavBuffer = await Promise.race([
      apiClient.tts(text, shopId),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("tts budget exceeded")), budgetMs)),
    ]);
    const file = new File(Paths.cache, `tts-${Crypto.randomUUID()}.wav`);
    await file.write(new Uint8Array(wavBuffer));
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
    const player = createAudioPlayer(file.uri);
    activePlayer = player;
    activeFile = file;
    player.play();
    return "tts";
  } catch {
    return "text-only";
  }
}
