"use client";

import { Mic, X } from "lucide-react";
import { useRef, useState } from "react";
import { MIN_CLIP_MS, Recorder } from "@/lib/audio/recorder";
import { cx, Spinner, SW } from "./ui";

/**
 * 66px Hold-to-Talk mic. Hold → record (turns #047857 with a REAL 5-bar AnalyserNode meter),
 * slide left to cancel, release to send. Auto-stops at 20 s.
 */
export function MicButton({ onClip, onDenied, busy }: { onClip: (blob: Blob, mime: string) => void; onDenied: (msg: string) => void; busy?: boolean }) {
  const rec = useRef<Recorder | null>(null);
  const startX = useRef(0);
  const [recording, setRecording] = useState(false);
  const [toggleMode, setToggleMode] = useState(false);
  const [levels, setLevels] = useState([0, 0, 0, 0, 0]);
  const [cancelling, setCancelling] = useState(false);
  const [secs, setSecs] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  // getUserMedia can take seconds (first-time permission prompt). If the finger lifts before the
  // recorder has actually started, remember that and tear the stream down the moment start resolves.
  const starting = useRef(false);
  const releasedEarly = useRef(false);

  const finish = async (cancel: boolean) => {
    if (starting.current) {
      releasedEarly.current = true;
      setCancelling(false);
      return;
    }
    const r = rec.current;
    rec.current = null;
    if (tick.current) clearInterval(tick.current);
    setRecording(false);
    setToggleMode(false);
    setLevels([0, 0, 0, 0, 0]);
    setCancelling(false);
    if (!r) return;
    if (cancel) {
      r.cancel();
      return;
    }
    try {
      const res = await r.stop();
      if (res.durationMs < MIN_CLIP_MS || res.blob.size < 800) {
        onDenied("Mic dabaa kar rakhein aur bolein (hold to talk)");
        return;
      }
      onClip(res.blob, res.mime);
    } catch (e) {
      onDenied(e instanceof Error ? e.message : "Recording failed");
    }
  };

  const beginRecording = async (isToggle: boolean) => {
    if (busy || rec.current) return;
    if (!Recorder.supported()) {
      onDenied("Is browser mein mic nahi — neeche type karein");
      return;
    }
    const r = new Recorder();
    rec.current = r;
    starting.current = true;
    releasedEarly.current = false;
    try {
      await r.start(setLevels, () => void finish(false));
      starting.current = false;
      if (releasedEarly.current) {
        releasedEarly.current = false;
        r.cancel();
        rec.current = null;
        setLevels([0, 0, 0, 0, 0]);
        onDenied("Mic dabaa kar rakhein aur bolein (hold to talk)");
        return;
      }
      setRecording(true);
      setToggleMode(isToggle);
      setSecs(0);
      tick.current = setInterval(() => setSecs((s) => s + 1), 1000);
      navigator.vibrate?.(15);
    } catch {
      starting.current = false;
      releasedEarly.current = false;
      rec.current = null;
      onDenied("Mic permission denied — typed input is open below");
    }
  };

  const start = async (e: React.PointerEvent) => {
    if (busy || rec.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
    await beginRecording(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (recording) void finish(false);
      else void beginRecording(true);
    } else if (e.key === "Escape" && recording) {
      e.preventDefault();
      void finish(true);
    }
  };

  return (
    <div className="relative flex flex-col items-center">
      {recording && (
        <div aria-live="polite" className="absolute -top-11 whitespace-nowrap rounded-full bg-ink px-3 py-1 text-[12px] font-semibold text-white num">
          {cancelling
            ? "Release to cancel"
            : toggleMode
              ? `0:${String(secs).padStart(2, "0")} · Press Space/Enter to stop`
              : `0:${String(secs).padStart(2, "0")} · ← slide to cancel`}
        </div>
      )}
      <button
        type="button"
        aria-label={recording ? "Recording voice — release or press Space to stop" : "Hold to talk, or press Space to toggle recording"}
        aria-pressed={recording}
        onKeyDown={onKeyDown}
        onPointerDown={start}
        onPointerMove={(e) => recording && !toggleMode && setCancelling(startX.current - e.clientX > 70)}
        onPointerUp={() => !toggleMode && void finish(cancelling)}
        onPointerCancel={() => void finish(true)}
        onContextMenu={(e) => e.preventDefault()}
        className={cx(
          "tactile grid h-[66px] w-[66px] select-none place-items-center rounded-full text-white shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors",
          recording ? (cancelling ? "bg-udhaar" : "bg-cash") : "bg-ink",
        )}
        style={{ touchAction: "none" }}
      >
        {busy ? (
          <Spinner className="h-6 w-6" />
        ) : recording ? (
          cancelling ? (
            <X size={26} strokeWidth={SW} />
          ) : (
            <span className="flex h-[26px] items-center gap-[3px]">
              {levels.map((l, i) => (
                <span key={i} className="eq-bar" style={{ height: `${6 + Math.round(l * 20)}px` }} />
              ))}
            </span>
          )
        ) : (
          <Mic size={24} strokeWidth={SW} />
        )}
      </button>
    </div>
  );
}
