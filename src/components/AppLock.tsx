"use client";

import { Delete, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cx, SW } from "./ui";

/**
 * Shared-phone safety (7E). Many shops share one phone across family and helpers, and women
 * shopkeepers often use a borrowed phone. An optional 4-digit PIN hides every balance until unlocked,
 * and re-locks after 60 s in the background. Stored as a salted SHA-256 hash; never sent anywhere.
 */
const KEY = "dukaanos.applock.v1";
const RELOCK_MS = 60_000;

interface LockRecord {
  salt: string;
  hash: string;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function readLock(): LockRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockRecord) : null;
  } catch {
    return null;
  }
}

export function isAppLockEnabled(): boolean {
  return typeof window !== "undefined" && readLock() !== null;
}

export async function setAppLockPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN 4 hindson ka hona chahiye");
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(KEY, JSON.stringify({ salt, hash: await sha256Hex(`${salt}:${pin}`) } satisfies LockRecord));
}

export function clearAppLock(): void {
  localStorage.removeItem(KEY);
}

async function checkPin(pin: string): Promise<boolean> {
  const rec = readLock();
  return !!rec && (await sha256Hex(`${rec.salt}:${pin}`)) === rec.hash;
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    setLocked(isAppLockEnabled());
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > RELOCK_MS && isAppLockEnabled()) setLocked(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <>
      {/* children stay mounted (offline queue keeps flushing) but are hidden from view and screen readers */}
      <div aria-hidden={locked} className={locked ? "invisible" : undefined}>{children}</div>
      {locked && <LockScreen onUnlock={() => setLocked(false)} />}
    </>
  );
}

function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);

  const press = useCallback(async (d: string) => {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    setWrong(false);
    if (next.length === 4) {
      if (await checkPin(next)) onUnlock();
      else {
        setWrong(true);
        setPin("");
        navigator.vibrate?.([30, 40, 30]);
      }
    }
  }, [pin, onUnlock]);

  return (
    <div role="dialog" aria-modal="true" aria-label="App locked" className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-canvas px-6">
      <Lock size={28} strokeWidth={SW} className="text-ink" aria-hidden />
      <h1 className="mt-3 text-[20px] font-bold tracking-[-0.02em]">DukaanOS locked</h1>
      <p className="mt-1 text-[14px] text-ink-2">PIN darj karein</p>
      <div className="mt-5 flex gap-3" aria-live="polite">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx("h-3.5 w-3.5 rounded-full border-2", wrong ? "border-udhaar" : "border-ink", i < pin.length && "bg-ink")} />
        ))}
      </div>
      {wrong && <p role="alert" className="mt-3 text-[14px] font-semibold text-udhaar">Ghalat PIN — dobara koshish karein</p>}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k) =>
          k === "" ? <span key="blank" /> : (
            <button
              key={k}
              type="button"
              aria-label={k === "del" ? "Delete" : k}
              onClick={() => (k === "del" ? setPin((p) => p.slice(0, -1)) : void press(k))}
              className="tactile grid h-16 w-16 place-items-center rounded-full bg-surface text-[24px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
            >
              {k === "del" ? <Delete size={22} strokeWidth={SW} /> : k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
