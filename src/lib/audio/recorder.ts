"use client";
/**
 * Push-to-talk recorder: dynamic MIME probing (webm/opus → webm → mp4 → ogg → wav), 24 kbps Opus,
 * 3–20 s clips, and a REAL 5-bar Web Audio AnalyserNode meter (no fake waveforms).
 */

export const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/wav"];
export const MAX_CLIP_MS = 20_000;
export const MIN_CLIP_MS = 600;

export function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* Safari throws on some probes */
    }
  }
  return "";
}

export interface RecordingResult {
  blob: Blob;
  mime: string;
  durationMs: number;
}

export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private startedAt = 0;
  private autoStop: ReturnType<typeof setTimeout> | null = null;
  mime = "";

  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  async start(onLevels: (levels: number[]) => void, onAutoStop?: () => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.mime = pickMime();
    this.rec = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: 24_000 });
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.startedAt = performance.now();

    const AC: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    const bins = new Uint8Array(this.analyser.frequencyBinCount);
    const bands = [[2, 6], [6, 12], [12, 20], [20, 32], [32, 48]];
    const loop = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(bins);
      onLevels(bands.map(([a, b]) => {
        let s = 0;
        for (let i = a; i < b; i++) s += bins[i];
        return Math.min(1, s / (b - a) / 200);
      }));
      this.raf = requestAnimationFrame(loop);
    };
    loop();
    this.autoStop = setTimeout(() => onAutoStop?.(), MAX_CLIP_MS);
  }

  elapsed(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  private teardown() {
    cancelAnimationFrame(this.raf);
    if (this.autoStop) clearTimeout(this.autoStop);
    this.analyser = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => undefined);
    this.stream = null;
    this.ctx = null;
  }

  stop(): Promise<RecordingResult> {
    const rec = this.rec;
    const durationMs = this.elapsed();
    return new Promise((resolve, reject) => {
      if (!rec) return reject(new Error("not recording"));
      rec.onstop = () => {
        const type = (rec.mimeType || this.mime || "audio/webm").split(";")[0];
        const blob = new Blob(this.chunks, { type });
        this.teardown();
        resolve({ blob, mime: type, durationMs });
      };
      rec.stop();
    });
  }

  cancel() {
    try {
      this.rec?.stop();
    } catch {
      /* noop */
    }
    this.chunks = [];
    this.teardown();
  }
}
