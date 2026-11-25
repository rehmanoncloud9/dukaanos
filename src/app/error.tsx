"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Route error:", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center px-6 text-center">
      <div className="surface-card w-full p-6">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-udhaar-bg text-udhaar-ink">
          <AlertCircle size={22} strokeWidth={1.75} />
        </div>
        <h1 className="mt-4 text-[22px] font-bold tracking-[-0.02em] text-ink">Kuch ghalat ho gaya</h1>
        <p className="mt-1.5 text-[14px] leading-5 text-ink-2">
          Something went wrong while loading this screen. Your saved khata &amp; offline queue are safe.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-ink-3">Ref: {error.digest}</p>
        )}
        <div className="mt-5 flex gap-2.5">
          <Link
            href="/"
            className="tactile flex h-12 flex-1 items-center justify-center rounded-[14px] bg-surface-sunken text-[15px] font-semibold text-ink"
          >
            Home
          </Link>
          <button
            onClick={reset}
            className="tactile flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-ink text-[15px] font-semibold text-white"
          >
            <RotateCcw size={16} strokeWidth={1.75} /> Retry
          </button>
        </div>
      </div>
    </main>
  );
}
