"use client";

import { useEffect } from "react";

/** Registers /sw.js so the PWA shell opens with zero network (offline queue lives in IndexedDB). */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
