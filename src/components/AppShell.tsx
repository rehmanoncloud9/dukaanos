"use client";

import { BookOpen, Camera, Lock, Mic, Package, QrCode, WifiOff } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { newKey } from "@/lib/client/api";
import { tr } from "@/lib/client/i18n";
import { DukaanProvider, useDukaan, type Tab } from "@/lib/client/store";
import { CustomerSheet, KhataTab } from "./KhataTab";
import { MaalTab, ProductSheet } from "./MaalTab";
import { MunshiTab } from "./MunshiTab";
import { CreateShop, Loading, SetupNeeded, Splash } from "./Onboarding";
import { PulseSheet } from "./PulseSheet";
import { AnswerSheet, PaymentSheet, PromiseSheet, ReceiptSheet, ReversalSheet, SaleReviewSheet } from "./ReviewSheets";
import { AppLockGate } from "./AppLock";
import { ReplaysSheet, SettingsSheet } from "./SettingsSheet";
import { cx, SW } from "./ui";

const XRaySheet = dynamic(() => import("./XRaySheet").then((m) => m.XRaySheet), { ssr: false });
const ParchiSheet = dynamic(() => import("./ParchiSheet").then((m) => m.ParchiSheet), { ssr: false });
const PassportSheet = dynamic(() => import("./KhataTab").then((m) => m.PassportSheet), { ssr: false });

export function DukaanApp() {
  return (
    <DukaanProvider>
      <AppLockGate>
        <Gate />
      </AppLockGate>
    </DukaanProvider>
  );
}

function Gate() {
  const { configured, authReady, session, shops } = useDukaan();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Loading />;
  if (!configured) return <SetupNeeded />;
  if (!authReady) return <Loading />;
  if (!session) return (
    <>
      <Splash />
      <Toasts />
    </>
  );
  if (shops === null) return <Loading />;
  if (shops.length === 0) return (
    <>
      <CreateShop />
      <Toasts />
    </>
  );
  return <Shell />;
}

function Shell() {
  const { tab, setTab, state, stateError, lastCommit, xrayOn, sheet, openSheet } = useDukaan();
  const seen = useRef<string | null>(null);

  // Judge mode (?xray=1 or header pill): every new commit unfolds its X-Ray automatically.
  useEffect(() => {
    const id = lastCommit?.response.transaction_id ?? null;
    if (!id || id === seen.current) return;
    seen.current = id;
    if (xrayOn && !sheet) openSheet({ type: "xray", txId: id });
  }, [lastCommit, xrayOn, sheet, openSheet]);

  useEffect(() => {
    const h = (e: Event) => setTab((e as CustomEvent<{ tab: Tab }>).detail.tab);
    window.addEventListener("dukaan:filter", h);
    return () => window.removeEventListener("dukaan:filter", h);
  }, [setTab]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("share") === "parchi") {
      setTab("maal");
      openSheet({ type: "parchi" });
      params.delete("share");
      const next = params.toString();
      window.history.replaceState({}, "", next ? `/?${next}` : "/");
    }
  }, [openSheet, setTab]);

  return (
    <>
      <div className="mx-auto min-h-dvh max-w-[430px] px-4 pb-[160px]">
        <Header />
        <JudgeBanner />
        <OfflineBanner />
        {stateError && !state && <div role="alert" aria-live="assertive" className="mb-3 rounded-[12px] bg-udhaar-bg px-3 py-2 text-[14px] text-udhaar-ink">{stateError}</div>}
        {tab === "munshi" && <MunshiTab />}
        {tab === "khata" && <KhataTab />}
        {tab === "maal" && <MaalTab />}
      </div>
      <TabBar />
      <UndoToast />
      <Toasts />
      <SheetRouter />
    </>
  );
}

function Header() {
  const { tab, state, shop, xrayOn, setXrayOn, openSheet, reviewCount, openQueuedReview, lang } = useDukaan();
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const name = state?.shop.name ?? shop?.name ?? "DukaanOS";

  const titleButton = (label: string) => (
    <button
      className="min-w-0 truncate text-left text-[22px] font-bold tracking-[-0.02em] select-none"
      onPointerDown={() => {
        longFired.current = false;
        press.current = setTimeout(() => {
          longFired.current = true;
          navigator.vibrate?.(30);
          openSheet({ type: "replays" }); // 2 s logo long-press → real-audio replay pills
        }, 2000);
      }}
      onPointerUp={() => press.current && clearTimeout(press.current)}
      onPointerLeave={() => press.current && clearTimeout(press.current)}
      onClick={() => !longFired.current && openSheet({ type: "settings" })}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );

  return (
    <header className="chrome-blur sticky top-0 z-20 -mx-4 mb-3 flex h-[60px] items-center gap-2 px-4">
      {tab === "munshi" && (
        <>
          {titleButton(name)}
          <span className={cx("inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 text-[11.5px] font-semibold text-ink-2", lang === "ur" && "urdu-ui")} dir="auto">
            <Lock size={11} strokeWidth={SW} /> {tr("zeroFbr", lang)}
          </span>
          {reviewCount > 0 && (
            <button
              onClick={() => void openQueuedReview()}
              aria-label={`Open ${reviewCount} queued review items`}
              className="tactile inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-amber-bg px-2.5 text-[12px] font-semibold text-amber-ink"
            >
              Review {reviewCount}
            </button>
          )}
          <button
            aria-label="Toggle X-Ray Judge Mode"
            aria-pressed={xrayOn}
            onClick={() => {
              const next = !xrayOn;
              setXrayOn(next);
              if (next) openSheet({ type: "xray" });
            }}
            className={cx("tactile ml-auto h-7 shrink-0 rounded-full border px-2.5 font-mono text-[12.5px] font-semibold", xrayOn ? "border-ink bg-ink text-white" : "border-black/15 bg-white",
              // Demo isolation: hide X-Ray pill on live shops unless already active (7I requirement)
              !xrayOn && !(shop?.is_demo_shop || shop?.is_stage_shop) && "hidden")}
          >
            {"</>"} X-Ray
          </button>
        </>
      )}
      {tab === "khata" && (
        <>
          {titleButton(tr("khata", lang))}
          <button onClick={() => openSheet({ type: "passport" })} className="tactile ml-auto flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-[13.5px] font-semibold text-white">
            <QrCode size={14} strokeWidth={SW} /> SMEConnect
          </button>
        </>
      )}
      {tab === "maal" && (
        <>
          {titleButton(tr("maal", lang))}
          <button onClick={() => openSheet({ type: "parchi" })} className={cx("tactile ml-auto flex h-8 items-center gap-1.5 rounded-full bg-maal px-3 text-[13.5px] font-semibold text-white", lang === "ur" && "urdu-ui")} dir="auto">
            <Camera size={14} strokeWidth={SW} /> {tr("scanParchi", lang)}
          </button>
        </>
      )}
    </header>
  );
}

function JudgeBanner() {
  const { xrayOn, setXrayOn, lang } = useDukaan();
  if (!xrayOn) return null;
  return (
    <div className="mb-2.5 flex items-center justify-between rounded-[12px] bg-ink px-3 py-1.5 text-[12px] font-medium text-white">
      <span dir="auto" className={lang === "ur" ? "urdu-ui" : "font-mono"}>{tr("judgeModeOn", lang)}</span>
      <button onClick={() => setXrayOn(false)} className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold">
        OFF
      </button>
    </div>
  );
}

function OfflineBanner() {
  const { online, pending, simulatedOffline, setSimulatedOffline, flush } = useDukaan();
  if (online && pending === 0) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-[12px] bg-amber-bg px-3 py-2 text-[13.5px] font-medium text-amber-ink">
      <WifiOff size={15} strokeWidth={SW} />
      <span className="flex-1">
        {online ? `Online · ${pending} Pending Sync (IndexedDB)` : `Net/bijli gayi? Sab mehfooz hai · ${pending} Pending Sync`}
      </span>
      <button
        onClick={() => (simulatedOffline ? setSimulatedOffline(false) : void flush())}
        className="tactile h-7 rounded-full bg-surface px-3 text-[12.5px] font-semibold"
      >
        {online ? "Sync now" : "Reconnect"}
      </button>
    </div>
  );
}

function TabBar() {
  const { tab, setTab, lang } = useDukaan();
  const items: Array<{ id: Tab; label: string; Icon: typeof Mic }> = [
    { id: "munshi", label: tr("munshi", lang), Icon: Mic },
    { id: "khata", label: tr("khata", lang), Icon: BookOpen },
    { id: "maal", label: tr("maal", lang), Icon: Package },
  ];
  return (
    <nav aria-label="Main navigation" className="tabbar-blur hairline-t fixed inset-x-0 bottom-0 z-40 pb-safe">
      <div role="tablist" className="mx-auto grid h-[58px] max-w-[430px] grid-cols-3">
        {items.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cx("flex min-h-[48px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold", tab === id ? "text-ink" : "text-ink-3")}
          >
            <Icon size={20} strokeWidth={SW} />
            <span dir="auto" className={lang === "ur" ? "urdu-ui text-[12px] leading-none" : ""}>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function UndoToast() {
  const { undo, doUndo } = useDukaan();
  if (!undo) return null;
  const left = Math.max(0, undo.until - Date.now());
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-[150px] z-40 mx-auto max-w-[430px] px-4">
      <div className="relative flex h-11 items-center overflow-hidden rounded-xl bg-[#0A0A0A] pl-4 pr-1 text-white shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{undo.message}</span>
        <button onClick={() => void doUndo()} className="tactile h-9 rounded-lg px-3 text-[14px] font-bold text-[#34D399]">
          UNDO
        </button>
        <span key={undo.id} className="countdown absolute bottom-0 left-0 h-[2px] w-full bg-[#34D399]" style={{ animationDuration: `${left}ms` }} />
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts } = useDukaan();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] mx-auto flex max-w-[430px] flex-col gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "err" ? "alert" : "status"}
          aria-live={t.tone === "err" ? "assertive" : "polite"}
          className={cx(
            "pointer-events-auto flex items-center gap-2 rounded-[14px] px-3.5 py-2.5 text-[13.5px] font-medium shadow-[0_8px_24px_rgba(0,0,0,0.12)] sheet-in",
            t.tone === "ok" && "bg-cash-bg text-cash-ink",
            t.tone === "warn" && "bg-amber-bg text-amber-ink",
            t.tone === "err" && "bg-udhaar-bg text-udhaar-ink",
            t.tone === "info" && "bg-surface text-ink",
          )}
        >
          <span className="flex-1">{t.message}</span>
          {t.action && (
            <button onClick={t.action.run} className="tactile rounded-full bg-surface/80 px-2.5 py-1 text-[12.5px] font-bold">
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function SheetRouter() {
  const { sheet, closeSheet } = useDukaan();
  if (!sheet) return null;
  switch (sheet.type) {
    case "review":
      return <SaleReviewSheet key={sheet.key} proposal={sheet.proposal} idemKey={sheet.key} trace={sheet.trace} onClose={closeSheet} />;
    case "payment":
      return <PaymentSheet key={sheet.key} proposal={sheet.proposal} idemKey={sheet.key} trace={sheet.trace} onClose={closeSheet} />;
    case "wasooli":
      return <PaymentSheet key={sheet.customerId} customerId={sheet.customerId} idemKey={newKey("wasooli")} trace={null} onClose={closeSheet} />;
    case "reversal":
      return <ReversalSheet target={sheet.target} onClose={closeSheet} />;
    case "pulse":
      return <PulseSheet pulse={sheet.pulse} onClose={closeSheet} />;
    case "answer":
      return <AnswerSheet answer={sheet.answer} proposal={sheet.proposal} trace={sheet.trace} tools={sheet.tools} onClose={closeSheet} />;
    case "xray":
      return <XRaySheet key={sheet.txId ?? "latest"} txId={sheet.txId} onClose={closeSheet} />;
    case "parchi":
      return <ParchiSheet autoSample={sheet.autoSample} onClose={closeSheet} />;
    case "passport":
      return <PassportSheet onClose={closeSheet} />;
    case "customer":
      return <CustomerSheet customerId={sheet.customerId} onClose={closeSheet} />;
    case "product":
      return <ProductSheet productId={sheet.productId} onClose={closeSheet} />;
    case "promise":
      return <PromiseSheet key={sheet.key} proposal={sheet.proposal} idemKey={sheet.key} trace={sheet.trace} onClose={closeSheet} />;
    case "settings":
      return <SettingsSheet onClose={closeSheet} />;
    case "replays":
      return <ReplaysSheet onClose={closeSheet} />;
    case "receipt":
      return <ReceiptSheet commit={sheet.commit} proposal={sheet.proposal} customerPhone={sheet.customerPhone} onClose={closeSheet} />;
    default:
      return null;
  }
}
