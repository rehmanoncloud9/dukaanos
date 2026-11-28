"use client";
/**
 * Ambient "Walkie-Talkie" Counter Mode (واکی ٹاکی موڈ).
 * Listens passively at the counter using Web Audio VAD, sends speech segments to Gemini
 * Multimodal Audio (or offline local-turn), filters casual chatter, auto-splits cash vs udhaar,
 * and speaks back a 2-second Urdu TTS confirmation.
 */

import { Radio, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { newKey } from "@/lib/client/api";
import { speak } from "@/lib/client/speak";
import { useDukaan } from "@/lib/client/store";
import { cx, SW } from "./ui";

const VAD_THRESHOLD = 0.025;
const SILENCE_MS = 1350;
const MIN_SPEECH_MS = 700;
const MAX_SEGMENT_MS = 14_000;

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

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as Record<string, unknown>).SpeechRecognition as (new () => SpeechRecognitionInstance)
    ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition as (new () => SpeechRecognitionInstance)
    ?? null;
}

export function WalkieTalkieBar() {
  const { submitTurn, thinking, undo, doUndo, toast } = useDukaan();
  const [active, setActive] = useState(false);
  const [speakingNow, setSpeakingNow] = useState(false);
  const [levels, setLevels] = useState([0, 0, 0, 0, 0]);
  const [lastStatus, setLastStatus] = useState<string>("کاؤنٹر مائیک بند ہے");

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const srRef = useRef<SpeechRecognitionInstance | null>(null);
  const lastTranscriptRef = useRef<string>("");
  const chunksRef = useRef<BlobPart[]>([]);
  const speechStartRef = useRef<number>(0);
  const lastVoiceRef = useRef<number>(0);
  const activeRef = useRef(false);
  const thinkingRef = useRef(thinking);
  const segmentInFlightRef = useRef(false);
  const muteUntilRef = useRef(0);

  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    setSpeakingNow(false);
    setLevels([0, 0, 0, 0, 0]);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
    recorderRef.current = null;
    try { srRef.current?.stop(); } catch { /* ignore */ }
    srRef.current = null;
    lastTranscriptRef.current = "";
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    setLastStatus("کاؤنٹر مائیک بند ہے");
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  const startSegment = useCallback((stream: MediaStream) => {
    if (!activeRef.current || recorderRef.current?.state === "recording") return;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
    const mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    chunksRef.current = [];
    speechStartRef.current = Date.now();
    lastVoiceRef.current = Date.now();
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const dur = Date.now() - speechStartRef.current;
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      const transcript = lastTranscriptRef.current.trim();
      lastTranscriptRef.current = "";
      chunksRef.current = [];
      recorderRef.current = null;
      if (dur >= MIN_SPEECH_MS && blob.size >= 1200 && activeRef.current && !segmentInFlightRef.current) {
        segmentInFlightRef.current = true;
        setLastStatus("منشی سن کر اندراج کر رہا ہے…");
        void (async () => {
          try {
            if (transcript && (typeof navigator !== "undefined" && !navigator.onLine)) {
              await submitTurn({ text: transcript, ambient: true }, newKey("walkie"));
            } else {
              await submitTurn({ blob, mime: blob.type || "audio/webm", text: transcript || undefined, ambient: true }, newKey("walkie"));
            }
            muteUntilRef.current = Date.now() + 2500;
            setLastStatus("آواز سن لی گئی — عام گفتگو نظر انداز ہو گی");
          } finally {
            segmentInFlightRef.current = false;
          }
        })();
      }
    };
    recorderRef.current = mr;
    mr.start(250);
    setSpeakingNow(true);
    setLastStatus("آواز ریکارڈ ہو رہی ہے…");
  }, [submitTurn]);

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
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      activeRef.current = true;
      setActive(true);
      setLastStatus("قدرتی طور پر بات کریں — غیر متعلقہ گفتگو نظر انداز ہو گی");
      void speak("کاؤنٹر مائیک آن ہے۔ دکان کا کام بولیں، دوسری گفتگو نظر انداز ہو گی۔");

      const SR = getSpeechRecognition();
      if (SR) {
        try {
          const sr = new SR();
          sr.lang = "ur-PK";
          sr.continuous = true;
          sr.interimResults = true;
          sr.onresult = (e: Event) => {
            const ev = e as unknown as { results: ArrayLike<{ [key: number]: { transcript: string } }> };
            const idx = ev.results.length - 1;
            if (idx >= 0) {
              const t = ev.results[idx]?.[0]?.transcript ?? "";
              if (t.trim()) lastTranscriptRef.current = t.trim();
            }
          };
          sr.onend = () => {
            if (activeRef.current) {
              try { sr.start(); } catch { /* ignore */ }
            }
          };
          sr.start();
          srRef.current = sr;
        } catch {
          /* optional browser SpeechRecognition */
        }
      }

      const loop = () => {
        if (!activeRef.current) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const norm = Math.min(1, rms * 10);
        setLevels([norm * 0.6, norm * 0.9, norm, norm * 0.85, norm * 0.55]);

        const now = Date.now();
        if (rms > VAD_THRESHOLD) {
          lastVoiceRef.current = now;
          if (!recorderRef.current && !segmentInFlightRef.current && !thinkingRef.current && now >= muteUntilRef.current) {
            startSegment(stream);
          }
        }
        if (recorderRef.current && recorderRef.current.state === "recording") {
          const silentFor = now - lastVoiceRef.current;
          const totalDur = now - speechStartRef.current;
          if (silentFor >= SILENCE_MS || totalDur >= MAX_SEGMENT_MS) {
            setSpeakingNow(false);
            recorderRef.current.stop();
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      toast("مائیک کی اجازت درکار ہے", "err");
      stopAll();
    }
  };

  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden" && activeRef.current) stopAll();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => document.removeEventListener("visibilitychange", stopWhenHidden);
  }, [stopAll]);

  return (
    <div
      dir="rtl"
      className={cx(
        "surface-card flex items-center gap-3 px-4 py-3 transition-colors",
        active ? "border-cash/40 bg-cash-bg/40" : "bg-surface",
      )}
    >
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={active}
        className={cx(
          "tactile flex h-14 min-w-[56px] shrink-0 items-center justify-center gap-2 rounded-[14px] px-4 text-[14px] font-bold text-white",
          active ? "bg-udhaar" : "bg-cash",
        )}
      >
        {active ? <Square size={18} strokeWidth={SW} /> : <Radio size={18} strokeWidth={SW} />}
        <span className="urdu-ui">{active ? "بند کریں" : "واکی ٹاکی"}</span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="urdu-ui truncate text-[14px] font-bold text-ink">
            {active ? (speakingNow ? "آواز ریکارڈ ہو رہی ہے…" : "لائیو کاؤنٹر مائیک آن") : "لائیو کاؤنٹر مائیک"}
          </span>
          {active && (
            <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
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
        <div className="urdu-ui truncate text-[12px] text-ink-2">{lastStatus}</div>
      </div>

      {undo ? (
        <button
          type="button"
          onClick={() => void doUndo()}
          className="tactile h-11 shrink-0 rounded-[12px] bg-ink px-3 text-[12.5px] font-bold text-white urdu-ui"
        >
          واپس
        </button>
      ) : (
        <button
          type="button"
          aria-label="وضاحت سنیں"
          onClick={() => void speak("واکی ٹاکی آن کریں، گاہک سے اردو یا پنجابی میں بات کریں، منشی خود بل اور ادھار لکھ کر آواز میں بتا دے گا۔")}
          className="tactile grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-surface-sunken text-ink"
        >
          <Volume2 size={18} strokeWidth={SW} />
        </button>
      )}
    </div>
  );
}
