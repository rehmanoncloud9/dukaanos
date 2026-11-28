"use client";
/**
 * Ambient "Walkie-Talkie" Counter Mode (واکی ٹاکی موڈ).
 * Continuous Web Audio PCM pre-roll (~450ms), asymmetric noise-floor VAD with hysteresis,
 * TTS barge-in interruption, and a non-blocking pipelined FIFO segment queue so shopkeepers
 * can speak back-to-back orders even while the previous turn is still processing.
 */

import { Radio, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { newKey } from "@/lib/client/api";
import { tr } from "@/lib/client/i18n";
import { isTtsSpeaking, speak, stopSpeaking } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { cx, SW } from "./ui";

const TARGET_SAMPLE_RATE = 16_000;
const BUFFER_SIZE = 2048;
const PRE_ROLL_MS = 450;
const SILENCE_MS = 1200;
const MIN_SPEECH_MS = 420;
const MAX_SEGMENT_MS = 15_000;
const MIN_NOISE_FLOOR = 0.003;
const MAX_NOISE_FLOOR = 0.013;

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: Event) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface QueuedSegment {
  key: string;
  blob: Blob;
  mime: string;
  transcript?: string;
}

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as Record<string, unknown>).SpeechRecognition as (new () => SpeechRecognitionInstance)
    ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition as (new () => SpeechRecognitionInstance)
    ?? null;
}

/** Downsample mono Float32 PCM chunks to a compact 16kHz 16-bit mono WAV Blob. */
function encodeWav16k(chunks: Float32Array[], srcRate: number): Blob {
  let totalIn = 0;
  for (const c of chunks) totalIn += c.length;
  const ratio = srcRate / TARGET_SAMPLE_RATE;
  const outLen = Math.max(1, Math.floor(totalIn / ratio));
  const buf = new ArrayBuffer(44 + outLen * 2);
  const view = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + outLen * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, outLen * 2, true);

  // Flatten chunks once for fast linear interpolation
  const mono = new Float32Array(totalIn);
  let pos = 0;
  for (const c of chunks) {
    mono.set(c, pos);
    pos += c.length;
  }

  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(totalIn - 1, i0 + 1);
    const frac = idx - i0;
    const sample = Math.max(-1, Math.min(1, mono[i0] + (mono[i1] - mono[i0]) * frac));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

function setGlobalWalkieQueue(len: number): void {
  if (typeof window !== "undefined") {
    (window as unknown as { __dukaanWalkieQueued?: number }).__dukaanWalkieQueued = len;
  }
}

export function WalkieTalkieBar() {
  const { submitTurn, undo, doUndo, toast, lang } = useDukaan();
  const [active, setActive] = useState(false);
  const [speakingNow, setSpeakingNow] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [levels, setLevels] = useState([0, 0, 0, 0, 0]);
  const [lastStatus, setLastStatus] = useState<string>("کاؤنٹر مائیک بند ہے");

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procNodeRef = useRef<ScriptProcessorNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const srRef = useRef<SpeechRecognitionInstance | null>(null);
  const srRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const srErrorsRef = useRef(0);
  const lastTranscriptRef = useRef<string>("");

  const activeRef = useRef(false);
  const recordingRef = useRef(false);
  const preRollRef = useRef<Float32Array[]>([]);
  const utteranceChunksRef = useRef<Float32Array[]>([]);
  const speechStartRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const onsetFramesRef = useRef(0);
  const bargeFramesRef = useRef(0);
  const voicedFramesRef = useRef(0);
  const peakRmsRef = useRef(0);
  const noiseFloorRef = useRef(0.005);
  const muteUntilRef = useRef(0);
  const lastMeterAtRef = useRef(0);

  const segmentQueueRef = useRef<QueuedSegment[]>([]);
  const drainingRef = useRef(false);
  const lastOutcomeAtRef = useRef(0);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (activeRef.current && segmentQueueRef.current.length > 0) {
        const seg = segmentQueueRef.current.shift()!;
        const remaining = segmentQueueRef.current.length;
        setQueuedCount(remaining);
        setGlobalWalkieQueue(remaining);
        setLastStatus(
          remaining > 0
            ? `${remaining} کمانڈ قطار میں — آپ بولتے رہیں…`
            : "منشی سن کر اندراج کر رہا ہے — آپ بولتے رہیں…",
        );
        try {
          if (seg.transcript && typeof navigator !== "undefined" && !navigator.onLine) {
            await submitTurn({ text: seg.transcript, ambient: true }, seg.key);
          } else {
            await submitTurn({ blob: seg.blob, mime: seg.mime, text: seg.transcript, ambient: true }, seg.key);
          }
        } catch {
          /* submitTurn handles error toasts / offline queue */
        }
      }
      if (activeRef.current && !recordingRef.current && Date.now() - lastOutcomeAtRef.current > 400) {
        setLastStatus("مائیک تیار — دکان کا کام بولیں");
      }
    } finally {
      drainingRef.current = false;
      setQueuedCount(segmentQueueRef.current.length);
      setGlobalWalkieQueue(segmentQueueRef.current.length);
    }
  }, [submitTurn]);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    recordingRef.current = false;
    setActive(false);
    setSpeakingNow(false);
    setQueuedCount(0);
    setGlobalWalkieQueue(0);
    setLevels([0, 0, 0, 0, 0]);
    segmentQueueRef.current = [];
    preRollRef.current = [];
    utteranceChunksRef.current = [];
    onsetFramesRef.current = 0;
    bargeFramesRef.current = 0;

    if (srRestartTimerRef.current) {
      clearTimeout(srRestartTimerRef.current);
      srRestartTimerRef.current = null;
    }
    try { srRef.current?.stop(); } catch { /* ignore */ }
    srRef.current = null;
    srErrorsRef.current = 0;
    lastTranscriptRef.current = "";

    if (procNodeRef.current) {
      procNodeRef.current.onaudioprocess = null;
      try { procNodeRef.current.disconnect(); } catch { /* ignore */ }
      procNodeRef.current = null;
    }
    try { sourceNodeRef.current?.disconnect(); } catch { /* ignore */ }
    sourceNodeRef.current = null;
    try { muteGainRef.current?.disconnect(); } catch { /* ignore */ }
    muteGainRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    stopSpeaking();
    setLastStatus("کاؤنٹر مائیک بند ہے");
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  const toggle = async () => {
    if (active) {
      stopAll();
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast("اس ڈیوائس پر مائیک دستیاب نہیں", "err");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      const muteGain = ctx.createGain();
      muteGain.gain.value = 0;
      src.connect(proc);
      proc.connect(muteGain);
      muteGain.connect(ctx.destination);
      sourceNodeRef.current = src;
      procNodeRef.current = proc;
      muteGainRef.current = muteGain;

      const maxPreRollChunks = Math.max(2, Math.ceil(((PRE_ROLL_MS / 1000) * ctx.sampleRate) / BUFFER_SIZE));

      activeRef.current = true;
      recordingRef.current = false;
      noiseFloorRef.current = 0.005;
      preRollRef.current = [];
      utteranceChunksRef.current = [];
      muteUntilRef.current = Date.now() + 2600;
      setActive(true);
      setLastStatus("مائیک تیار — دکان کا کام بولیں");
      void speak("کاؤنٹر مائیک آن ہے۔");

      const SR = getSpeechRecognition();
      if (SR) {
        try {
          const sr = new SR();
          sr.lang = "ur-PK";
          sr.continuous = true;
          sr.interimResults = true;
          sr.onresult = (e: Event) => {
            srErrorsRef.current = 0;
            if (!recordingRef.current) return;
            const ev = e as unknown as { results: ArrayLike<{ [key: number]: { transcript: string } }> };
            const idx = ev.results.length - 1;
            if (idx >= 0) {
              const t = ev.results[idx]?.[0]?.transcript ?? "";
              if (t.trim()) lastTranscriptRef.current = t.trim();
            }
          };
          sr.onerror = () => {
            srErrorsRef.current += 1;
          };
          sr.onend = () => {
            if (activeRef.current && srErrorsRef.current < 3) {
              srRestartTimerRef.current = setTimeout(() => {
                if (activeRef.current) {
                  try { sr.start(); } catch { /* ignore */ }
                }
              }, 300);
            }
          };
          sr.start();
          srRef.current = sr;
        } catch {
          /* optional browser SpeechRecognition */
        }
      }

      proc.onaudioprocess = (ev) => {
        if (!activeRef.current) return;
        const input = ev.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(input);
        let sum = 0;
        for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
        const rms = Math.sqrt(sum / chunk.length);
        const now = Date.now();

        if (now - lastMeterAtRef.current >= 60) {
          lastMeterAtRef.current = now;
          const norm = Math.min(1, rms * 12);
          setLevels([norm * 0.6, norm * 0.9, norm, norm * 0.85, norm * 0.55]);
        }

        const ttsBusy = isTtsSpeaking() || now < muteUntilRef.current;

        // Update noise floor asymmetrically only on quiet idle frames (never inflate on speech).
        if (!recordingRef.current && !ttsBusy && rms < 0.022) {
          const lr = rms < noiseFloorRef.current ? 0.08 : 0.008;
          const nextFloor = noiseFloorRef.current * (1 - lr) + rms * lr;
          noiseFloorRef.current = Math.min(MAX_NOISE_FLOOR, Math.max(MIN_NOISE_FLOOR, nextFloor));
        }

        const onsetThresh = Math.min(0.026, Math.max(0.011, noiseFloorRef.current * 1.85));
        const sustainThresh = onsetThresh * 0.65;
        const bargeInThresh = Math.max(0.036, onsetThresh * 2.2);

        if (!recordingRef.current) {
          preRollRef.current.push(chunk);
          if (preRollRef.current.length > maxPreRollChunks) preRollRef.current.shift();

          if (ttsBusy) {
            if (rms > bargeInThresh) {
              bargeFramesRef.current += 1;
              if (bargeFramesRef.current >= 3) {
                // Shopkeeper interrupted TTS: barge in and capture with pre-roll!
                stopSpeaking();
                muteUntilRef.current = 0;
                bargeFramesRef.current = 0;
                recordingRef.current = true;
                utteranceChunksRef.current = [...preRollRef.current];
                lastTranscriptRef.current = "";
                speechStartRef.current = now;
                lastVoiceRef.current = now;
                voicedFramesRef.current = 2;
                peakRmsRef.current = rms;
                setSpeakingNow(true);
                setLastStatus("آواز ریکارڈ ہو رہی ہے…");
              }
            } else {
              bargeFramesRef.current = 0;
            }
            return;
          }

          if (rms > onsetThresh) {
            onsetFramesRef.current += rms > onsetThresh * 1.5 ? 2 : 1;
            if (onsetFramesRef.current >= 2) {
              onsetFramesRef.current = 0;
              recordingRef.current = true;
              utteranceChunksRef.current = [...preRollRef.current];
              lastTranscriptRef.current = "";
              speechStartRef.current = now;
              lastVoiceRef.current = now;
              voicedFramesRef.current = 1;
              peakRmsRef.current = rms;
              setSpeakingNow(true);
              setLastStatus("آواز ریکارڈ ہو رہی ہے…");
            }
          } else {
            onsetFramesRef.current = 0;
          }
          return;
        }

        // Recording active speech segment (never blocked by previous turn in flight).
        utteranceChunksRef.current.push(chunk);
        if (rms > peakRmsRef.current) peakRmsRef.current = rms;
        if (rms > sustainThresh) {
          lastVoiceRef.current = now;
          voicedFramesRef.current += 1;
        }

        const silentFor = now - lastVoiceRef.current;
        const totalDur = now - speechStartRef.current;
        if (silentFor >= SILENCE_MS || totalDur >= MAX_SEGMENT_MS) {
          const captured = utteranceChunksRef.current;
          const voicedFrames = voicedFramesRef.current;
          const peakRms = peakRmsRef.current;
          const transcript = lastTranscriptRef.current.trim() || undefined;

          recordingRef.current = false;
          utteranceChunksRef.current = [];
          preRollRef.current = totalDur >= MAX_SEGMENT_MS ? captured.slice(-maxPreRollChunks) : [];
          lastTranscriptRef.current = "";
          onsetFramesRef.current = 0;
          setSpeakingNow(false);

          if (totalDur >= MIN_SPEECH_MS && voicedFrames >= 4 && peakRms >= onsetThresh * 1.15) {
            const wav = encodeWav16k(captured, ctx.sampleRate);
            segmentQueueRef.current.push({
              key: newKey("walkie"),
              blob: wav,
              mime: "audio/wav",
              transcript,
            });
            setQueuedCount(segmentQueueRef.current.length);
            setGlobalWalkieQueue(segmentQueueRef.current.length);
            void drainQueue();
          } else if (!drainingRef.current && segmentQueueRef.current.length === 0) {
            setLastStatus("مائیک تیار — دکان کا کام بولیں");
          }
        }
      };
    } catch {
      toast("مائیک کی اجازت درکار ہے", "err");
      stopAll();
    }
  };

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden" && activeRef.current) stopAll();
    };
    const onTtsState = (e: Event) => {
      const speaking = (e as CustomEvent<{ speaking?: boolean }>).detail?.speaking;
      if (speaking === false && activeRef.current) {
        muteUntilRef.current = Math.max(muteUntilRef.current, Date.now() + 350);
      }
    };
    const onTurnOutcome = (e: Event) => {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      if (!activeRef.current || recordingRef.current) return;
      if (kind === "ambient_ignored") {
        lastOutcomeAtRef.current = Date.now();
        setLastStatus("عام گفتگو نظر انداز کی گئی — کاروباری بات بولیں");
      } else if (kind === "sale") {
        lastOutcomeAtRef.current = Date.now();
        setLastStatus("اندراج ہو گیا ✓ — اگلا بولیں");
      }
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("dukaan:tts-state", onTtsState);
    window.addEventListener("dukaan:turn-outcome", onTurnOutcome);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("dukaan:tts-state", onTtsState);
      window.removeEventListener("dukaan:turn-outcome", onTurnOutcome);
    };
  }, [stopAll]);

  return (
    <div
      dir={lang === "ur" ? "rtl" : "ltr"}
      className={cx(
        "surface-card flex items-center justify-between gap-2.5 px-3 py-2 transition-colors",
        active ? "border-cash/40 bg-cash-bg/40" : "bg-surface",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-[10px]", active ? "bg-cash text-white" : "bg-cash-bg text-cash-ink")}>
          <Radio size={15} strokeWidth={SW} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cx("truncate text-[13px] font-bold text-ink leading-tight", lang === "ur" && "urdu-ui")}>
              {active ? (speakingNow ? "آواز ریکارڈ ہو رہی ہے…" : tr("walkieTalkie", lang)) : tr("walkieTalkie", lang)}
            </span>
            {active && queuedCount > 0 && (
              <span className="shrink-0 rounded-full bg-amber-bg px-1.5 py-0.5 text-[10px] font-bold text-amber-ink num">
                +{queuedCount}
              </span>
            )}
            {active && (
              <div className="flex h-3 items-end gap-0.5" aria-hidden="true">
                {levels.map((lvl, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-cash transition-all duration-75"
                    style={{ height: `${Math.max(20, Math.round(lvl * 100))}%` }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="urdu-ui truncate text-[11px] leading-tight text-ink-2">{lastStatus}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {undo && (
          <button
            type="button"
            onClick={() => void doUndo()}
            className="tactile h-9 shrink-0 rounded-[10px] bg-ink px-2.5 text-[12px] font-bold text-white urdu-ui"
          >
            واپس
          </button>
        )}
        <button
          type="button"
          onClick={() => void toggle()}
          aria-pressed={active}
          className={cx(
            "tactile flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold text-white",
            active ? "bg-udhaar" : "bg-cash",
          )}
        >
          {active ? <Square size={13} strokeWidth={SW} /> : <Radio size={13} strokeWidth={SW} />}
          <span className={cx(lang === "ur" && "urdu-ui")}>{active ? tr("walkieStop", lang) : tr("walkieBtn", lang)}</span>
        </button>
      </div>
    </div>
  );
}
