"use client";

import { clearAppLock, isAppLockEnabled, setAppLockPin } from "./AppLock";
import { Download, FileAudio, LogOut, Play, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Upload, UserX, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, friendlyError } from "@/lib/client/api";
import { downloadCsv, exportKhataCsv, exportMaalCsv } from "@/lib/client/csv-export";
import { tr, type Lang } from "@/lib/client/i18n";
import { listReplays, type ReplayClip } from "@/lib/client/queue";
import { useDukaan } from "@/lib/client/store";
import { formatRs, rupeesToPaisa } from "@/lib/domain/money";
import { cx, Pill, PrimaryButton, SecondaryButton, Segmented, Sheet, Spinner, SW } from "./ui";

interface Health {
  ok: boolean;
  missing_env: string[];
  pinned_models: Record<string, string | null>;
  models_available: Record<string, boolean> | null;
  model_check_error: string | null;
  cutover_audit: { gemini_2_5_references: number; ok: boolean };
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { shops, shop, setShopId, state, pending, queue, flush, openQueuedReview, discardQueued, simulatedOffline, setSimulatedOffline, refresh, toast, signOut, openSheet, submitTurn, session, lang, setLang } = useDukaan();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; code: string; checked: number; ms: number; first_broken_seq?: number } | null>(null);
  // Shift Handover — Galla Count
  const [gallaInput, setGallaInput] = useState("");
  const gallaActual = rupeesToPaisa(Number(gallaInput || 0));
  const gallaSystem = state?.today.cash_in_galla_paisa ?? 0;
  const gallaDiff = gallaActual - gallaSystem;

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(friendlyError(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const demoCall = (action: "reset" | "tamper") =>
    act(action, async () => {
      const r = await api<{ result: { tampered_seq?: number } }>(`/api/demo/${action}`, { json: { shop_id: shop!.id, secret: secret || undefined }, timeoutMs: 120_000 });
      await refresh();
      if (action === "tamper") {
        toast(`Ledger row #${r.result.tampered_seq} silently edited — now run Verify chain`, "warn");
        setChain(null);
      } else {
        toast("Demo shop reset & re-seeded (14-day history)", "ok");
        setChain(null);
      }
    });

  return (
    <Sheet open onClose={onClose} title={tr("settings", lang)}>
      <div className="space-y-4 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <section>
          <div className="section-label mb-2" dir="auto">{tr("language", lang)}</div>
          <Segmented<Lang>
            value={lang}
            onChange={setLang}
            options={[
              { value: "en", label: "English" },
              { value: "ur", label: "اردو" },
            ]}
          />
        </section>

        <section>
          <div className="section-label mb-2">Shop</div>
          <div className="surface-card overflow-hidden">
            {shops?.map((s) => (
              <button key={s.id} onClick={() => setShopId(s.id)} className="hairline-b flex w-full items-center justify-between px-4 py-3 text-left last:border-b-0">
                <span>
                  <span className="block text-[15px] font-semibold">{s.name}</span>
                  <span className="text-[12.5px] text-ink-2">{s.is_stage_shop ? "Stage shop (protected)" : s.is_demo_shop ? "Isolated judge sandbox" : s.city ?? "Live shop"} · {s.role}</span>
                </span>
                {shop?.id === s.id && <Pill tone="cash">Active</Pill>}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[12px] text-ink-2">{session?.user.email}</div>
        </section>

        <AppLockSection />

        {/* Shift Handover · Galla Count */}
        <section>
          <div className="section-label mb-2">Shift Handover · Galla Count</div>
          <div className="surface-card p-4 space-y-3">
            <div className="text-[13px] text-ink-2">Drawer mein giye paison ka hisaab karein aur system se compare karein.</div>
            <div className="flex gap-2 items-center">
              <span className="text-[14px] font-semibold shrink-0">Rs.</span>
              <input
                inputMode="numeric"
                value={gallaInput}
                onChange={(e) => setGallaInput(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Actual cash counted"
                className="num h-11 min-w-0 flex-1 rounded-[12px] border border-black/15 px-3 text-[16px] outline-none"
              />
            </div>
            {gallaInput && (
              <div className={cx("rounded-[10px] px-3 py-2.5 text-[14px] font-semibold", gallaDiff === 0 ? "bg-cash-bg text-cash-ink" : "bg-udhaar-bg text-udhaar-ink")}>
                System: {formatRs(gallaSystem)} · Actual: {formatRs(gallaActual)} ·{" "}
                {gallaDiff === 0 ? "✓ Match" : gallaDiff > 0 ? `+${formatRs(gallaDiff)} extra` : `${formatRs(Math.abs(gallaDiff))} short`}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-label mb-2">Offline sync</div>
          <div className="surface-card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <Pill tone={pending ? "amber" : "cash"}>{pending} Pending Sync</Pill>
              <button onClick={() => void act("flush", flush)} className="tactile flex h-8 items-center gap-1.5 rounded-full bg-surface-sunken px-3 text-[13px] font-semibold">
                {busy === "flush" ? <Spinner /> : <RefreshCw size={13} strokeWidth={SW} />} Flush now
              </button>
            </div>
            <button onClick={() => setSimulatedOffline(!simulatedOffline)} className={cx("tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold", simulatedOffline ? "bg-amber-bg text-amber-ink" : "bg-surface-sunken")}>
              <WifiOff size={15} strokeWidth={SW} /> Simulate Offline: {simulatedOffline ? "ON" : "OFF"}
            </button>
            {queue.map((q) => (
              <div key={q.idempotency_key} className="flex items-center gap-2 text-[13px]">
                <FileAudio size={14} strokeWidth={SW} className="text-ink-2" />
                <span className="min-w-0 flex-1 truncate">{q.kind === "text" ? q.text : `Voice clip · ${new Date(q.created_at).toLocaleTimeString()}`}</span>
                <Pill tone={q.status === "review" ? "maal" : q.status === "failed" ? "udhaar" : "amber"}>{q.status}</Pill>
                {q.status !== "pending" && (
                  <button
                    className="tactile min-h-[36px] px-2 text-[12.5px] font-semibold text-cash"
                    onClick={() =>
                      q.status === "review"
                        ? void openQueuedReview(q.idempotency_key)
                        : void submitTurn({ blob: q.blob, mime: q.mime, text: q.text }, q.idempotency_key)
                    }
                  >
                    Open
                  </button>
                )}
                <button aria-label="Discard" onClick={() => void discardQueued(q.idempotency_key)} className="grid h-9 w-9 place-items-center text-ink-3">
                  <Trash2 size={14} strokeWidth={SW} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="section-label mb-2">Judge proof tools</div>
          <div className="surface-card space-y-2.5 p-4">
            <button
              onClick={() => void act("chain", async () => setChain(await api("/api/shop/chain")))}
              className="tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[14px] font-semibold"
            >
              {busy === "chain" ? <Spinner /> : <ShieldCheck size={15} strokeWidth={SW} />} Verify SHA-256 chain
            </button>
            {chain && (
              <div className={cx("rounded-[10px] px-3 py-2 font-mono text-[12px]", chain.ok ? "bg-cash-bg text-cash-ink" : "bg-udhaar-bg text-udhaar-ink")}>
                {chain.ok ? `CHAIN_OK · ${chain.checked} links · ${chain.ms}ms` : `CHAIN_BROKEN at #${chain.first_broken_seq} (${chain.code})`}
              </div>
            )}
            {shop?.is_demo_shop && (
              <>
                {shop.is_stage_shop && (
                  <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" placeholder="DEMO_RESET_SECRET (stage shop)" className="h-10 w-full rounded-[10px] bg-canvas px-3 text-[14px] outline-none" />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <SecondaryButton onClick={() => void demoCall("tamper")} className="flex h-10 items-center justify-center gap-1.5 text-[13px]">
                    {busy === "tamper" ? <Spinner /> : <ShieldAlert size={14} strokeWidth={SW} />} Tamper test
                  </SecondaryButton>
                  <PrimaryButton onClick={() => void demoCall("reset")} busy={busy === "reset"} className="h-10 text-[13px]">
                    Judge Demo Reset
                  </PrimaryButton>
                </div>
                <p className="text-[12px] text-ink-2">Tamper test edits one historical ledger row behind the app’s back (balanced, so SUM=0 still holds) — the hash chain catches it. Reset restores the shop.</p>
              </>
            )}
            <button onClick={() => openSheet({ type: "replays" })} className="tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[14px] font-semibold">
              <Play size={14} strokeWidth={SW} /> Real-audio replay library
            </button>
          </div>
        </section>

        <section>
          <div className="section-label mb-2">Health · Dec 1 cutover audit</div>
          <div className="surface-card p-4">
            <button onClick={() => void act("health", async () => setHealth(await api<Health>("/api/system/health", { shop: false })))} className="tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[14px] font-semibold">
              {busy === "health" && <Spinner />} Run health check
            </button>
            {health && (
              <div className="mt-3 space-y-1 font-mono text-[11.5px]">
                {Object.entries(health.pinned_models).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}: {v ?? "—"}</span>
                    <span className={health.models_available?.[k] ? "text-cash" : health.models_available ? "text-udhaar" : "text-ink-2"}>
                      {health.models_available ? (health.models_available[k] ? "live ✓" : v ? "missing ✗" : "") : "?"}
                    </span>
                  </div>
                ))}
                <div className={health.cutover_audit.ok ? "text-cash" : "text-udhaar"}>gemini-2.5 refs: {health.cutover_audit.gemini_2_5_references}</div>
                {health.missing_env.length > 0 && <div className="text-udhaar">missing env: {health.missing_env.join(", ")}</div>}
                {health.model_check_error && <div className="text-ink-2">model list: {health.model_check_error.slice(0, 120)}</div>}
              </div>
            )}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <a href="/verify" target="_blank" rel="noreferrer" className="tactile flex h-11 items-center justify-center rounded-[12px] bg-surface-sunken text-[13px] font-semibold">
            /verify
          </a>
          <a href="/report" target="_blank" rel="noreferrer" className="tactile flex h-11 items-center justify-center rounded-[12px] bg-surface-sunken text-[13px] font-semibold">
            SMEConnect report
          </a>
        </div>

        <section>
          <div className="section-label mb-2">Data rights &amp; legal</div>
          <div className="space-y-2">
            <button
              onClick={() =>
                void act("export", async () => {
                  const data = await api<Record<string, unknown>>("/api/account/export");
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `dukaanos-export-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast("Shop data exported (JSON)", "ok");
                })
              }
              className="tactile flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[14px] font-semibold"
            >
              {busy === "export" ? <Spinner /> : <Download size={15} strokeWidth={SW} />} {tr("exportData", lang)}
            </button>
            {state && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    downloadCsv(`dukaanos-khata-${new Date().toISOString().slice(0, 10)}.csv`, exportKhataCsv(state.customers));
                    toast("Khata CSV downloaded", "ok");
                  }}
                  className="tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] bg-surface-sunken text-[13px] font-semibold"
                >
                  <Download size={13} strokeWidth={SW} /> Khata CSV
                </button>
                <button
                  onClick={() => {
                    downloadCsv(`dukaanos-maal-${new Date().toISOString().slice(0, 10)}.csv`, exportMaalCsv(state.products));
                    toast("Maal (Stock) CSV downloaded", "ok");
                  }}
                  className="tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] bg-surface-sunken text-[13px] font-semibold"
                >
                  <Download size={13} strokeWidth={SW} /> Stock CSV
                </button>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <a href="/privacy" target="_blank" rel="noreferrer" className="tactile flex h-10 items-center justify-center rounded-[12px] bg-surface-sunken text-[13px] font-semibold">
                {tr("privacy", lang)}
              </a>
              <a href="/terms" target="_blank" rel="noreferrer" className="tactile flex h-10 items-center justify-center rounded-[12px] bg-surface-sunken text-[13px] font-semibold">
                {tr("terms", lang)}
              </a>
              <a href="/delete-account" className="tactile flex h-10 items-center justify-center gap-1 rounded-[12px] bg-udhaar-bg text-[12.5px] font-semibold text-udhaar-ink">
                <UserX size={13} strokeWidth={SW} /> Delete
              </a>
            </div>
          </div>
        </section>

        <button onClick={() => void signOut()} className="tactile flex h-12 w-full items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold text-udhaar-ink">
          <LogOut size={15} strokeWidth={SW} /> {tr("signOut", lang)}
        </button>
      </div>
    </Sheet>
  );
}

/** Stage backup: replay a REAL previously-recorded clip through the live pipeline (new idempotency key). */
export function ReplaysSheet({ onClose }: { onClose: () => void }) {
  const { submitTurn, closeSheet } = useDukaan();
  const [clips, setClips] = useState<ReplayClip[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void listReplays().then(setClips);
  }, []);
  const send = (blob: Blob, mime: string) => {
    closeSheet();
    void submitTurn({ blob, mime });
  };
  return (
    <Sheet open onClose={onClose} title="Real-audio replay">
      <div className="space-y-2.5 px-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <p className="text-[13px] text-ink-2">Every clip you record is kept on this phone (last 12). If the auditorium echo kills the live mic, replay a real recording through the same pipeline.</p>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) send(f, f.type || "audio/webm");
        }} />
        <SecondaryButton className="flex w-full items-center justify-center gap-2" onClick={() => fileRef.current?.click()}>
          <Upload size={15} strokeWidth={SW} /> Load audio file
        </SecondaryButton>
        <div className="surface-card overflow-hidden">
          {clips === null && <div className="p-4"><Spinner /></div>}
          {clips?.length === 0 && <div className="p-4 text-[13px] text-ink-2">No recordings yet — use the mic once.</div>}
          {clips?.map((c) => (
            <div key={c.id} className="hairline-b flex items-center gap-2 px-4 py-3 last:border-b-0">
              <button aria-label="Play" onClick={() => void new Audio(URL.createObjectURL(c.blob)).play()} className="tactile grid h-9 w-9 place-items-center rounded-full bg-surface-sunken">
                <Play size={14} strokeWidth={SW} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[13.5px]" dir="auto">{c.transcript}</span>
              <button onClick={() => send(c.blob, c.mime)} className="tactile h-8 rounded-full bg-ink px-3 text-[12.5px] font-semibold text-white">
                Replay
              </button>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/** 7E — optional 4-digit PIN for shared phones (stored as a salted hash on this device only). */
function AppLockSection() {
  const { toast } = useDukaan();
  const [enabled, setEnabled] = useState(false);
  const [pin, setPin] = useState("");
  useEffect(() => setEnabled(isAppLockEnabled()), []);
  return (
    <section>
      <div className="section-label mb-2">App lock · shared phone</div>
      <div className="surface-card p-4">
        {enabled ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px]">PIN laga hua hai — 1 minute baad app khud lock ho jati hai.</span>
            <button onClick={() => { clearAppLock(); setEnabled(false); toast("App lock hata diya", "info"); }} className="tactile h-11 shrink-0 rounded-[12px] bg-surface-sunken px-3 text-[14px] font-semibold">Hata dein</button>
          </div>
        ) : (
          <form className="flex gap-2" onSubmit={(e) => {
            e.preventDefault();
            void setAppLockPin(pin).then(() => { setEnabled(true); setPin(""); toast("PIN set — balances ab chhupe rahenge", "ok"); }).catch((err: unknown) => toast(err instanceof Error ? err.message : "PIN set nahi hua", "err"));
          }}>
            <input inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4-digit PIN" aria-label="New 4-digit PIN"
              className="num h-11 min-w-0 flex-1 rounded-[12px] border border-black/15 px-3 text-[15px] tracking-[0.3em]" />
            <button type="submit" disabled={pin.length !== 4} className="tactile h-11 shrink-0 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white disabled:opacity-40">PIN lagayein</button>
          </form>
        )}
      </div>
    </section>
  );
}
