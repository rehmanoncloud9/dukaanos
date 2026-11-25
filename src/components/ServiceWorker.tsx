"use client";

import { useEffect, useState } from "react";

/** Registers /sw.js so the PWA shell opens with zero network and prompts when a new SW version is waiting. */
export function ServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(nw);
            }
          });
        });
      })
      .catch(() => undefined);

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-[76px] z-50 mx-auto max-w-[430px] px-4">
      <button
        onClick={() => waiting.postMessage("SKIP_WAITING")}
        className="tactile flex h-11 w-full items-center justify-between rounded-[14px] bg-ink px-4 text-[13.5px] font-semibold text-white shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
      >
        <span>New version ready</span>
        <span className="text-[#34D399]">Update</span>
      </button>
    </div>
  );
}
