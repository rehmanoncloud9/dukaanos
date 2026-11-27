"use client";

import { clearAppLock, isAppLockEnabled, setAppLockPin } from "./AppLock";
import { ChevronDown, ChevronUp, Code2, Download, FileAudio, LogOut, Play, RefreshCw, ShieldAlert, ShieldCheck, Trash2, Upload, UserX, Volume2, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, friendlyError } from "@/lib/client/api";
import { downloadCsv, exportKhataCsv, exportMaalCsv } from "@/lib/client/csv-export";
import { parseCustomerCsv, parseProductCsv } from "@/lib/client/csv-import";
import { tr, type Lang } from "@/lib/client/i18n";
import { listReplays, type ReplayClip } from "@/lib/client/queue";
import { useDukaan } from "@/lib/client/store";
import { eodSummaryText, waLink } from "@/lib/domain/messages";
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
  const { shops, shop, setShopId, state, pending, queue, queuedCommits, flush, openQueuedReview, discardQueued, retryCommit, discardCommit, simulatedOffline, setSimulatedOffline, xrayOn, setXrayOn, helperMode, setHelperMode, refresh, reloadShops, toast, signOut, openSheet, submitTurn, session, lang, setLang } = useDukaan();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [chain, setChain] = useState<{ ok: boolean; code: string; checked: number; ms: number; first_broken_seq?: number } | null>(null);
  const [showDevTools, setShowDevTools] = useState(xrayOn);
  const [editingProfile, setEditingProfile] = useState(false);
  const [shopNameInput, setShopNameInput] = useState(state?.shop.name ?? shop?.name ?? "");
  const [shopCityInput, setShopCityInput] = useState(state?.shop.city ?? shop?.city ?? "");
  const [shopPhoneInput, setShopPhoneInput] = useState(state?.shop.phone ?? "");
  // Shift Handover — Galla Count
  const [gallaInput, setGallaInput] = useState("");
  const [raastId, setRaastId] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(() => typeof window !== "undefined" && localStorage.getItem("dukaanos.autoSpeak") === "1");
  const [storageInfo, setStorageInfo] = useState<string | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const prodCsvRef = useRef<HTMLInputElement>(null);
  const gallaActual = rupeesToPaisa(Number(gallaInput || 0));
  const gallaSystem = state?.today.cash_in_galla_paisa ?? 0;
  const gallaDiff = gallaActual - gallaSystem;

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        if (est.usage !== undefined && est.quota) {
          const mb = (est.usage / (1024 * 1024)).toFixed(1);
          const pct = Math.max(1, Math.round((est.usage / est.quota) * 100));
          setStorageInfo(`${mb} MB used (${pct}%)`);
        }
      }).catch(() => undefined);
    }
  }, []);

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
          <button
            type="button"
            onClick={() => {
              const next = !autoSpeak;
              setAutoSpeak(next);
              try {
                localStorage.setItem("dukaanos.autoSpeak", next ? "1" : "0");
              } catch {
                /* ignore */
              }
              toast(next ? "Urdu audio confirmations ON" : "Audio confirmations OFF", "info");
            }}
            className="tactile mt-2 flex h-10 w-full items-center justify-between rounded-[12px] bg-surface px-3.5 text-[13.5px] font-medium"
          >
            <span className="flex items-center gap-2"><Volume2 size={15} strokeWidth={SW} /> {tr("autoSpeak", lang)}</span>
            <Pill tone={autoSpeak ? "cash" : "neutral"}>{autoSpeak ? "ON" : "OFF"}</Pill>
          </button>
        </section>

        <section>
          <div className="section-label mb-2">Shop</div>
          <div className="surface-card overflow-hidden">
            {shops?.map((s) => (
              <button key={s.id} onClick={() => setShopId(s.id)} className="hairline-b flex w-full items-center justify-between px-4 py-3 text-left last:border-b-0">
                <span>
                  <span className="block text-[15px] font-semibold">{s.name}</span>
                  <span className="text-[12.5px] text-ink-2">{s.is_stage_shop ? "Stage shop" : s.is_demo_shop ? (xrayOn ? "Isolated judge sandbox" : "Demo dukaan") : s.city ?? "Live shop"} · {s.role}</span>
                </span>
                {shop?.id === s.id && <Pill tone="cash">Active</Pill>}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[12px] text-ink-2">
            <span>{session?.user.email}</span>
            <div className="flex items-center gap-3">
              {!helperMode && (
                <button
                  type="button"
                  onClick={() => {
                    setShopNameInput(state?.shop.name ?? shop?.name ?? "");
                    setShopCityInput(state?.shop.city ?? shop?.city ?? "");
                    setShopPhoneInput(state?.shop.phone ?? "");
                    setEditingProfile((v) => !v);
                  }}
                  className="font-semibold text-ink underline underline-offset-2"
                >
                  {editingProfile ? "Close edit" : "Edit shop"}
                </button>
              )}
              {shop?.is_demo_shop && (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="font-semibold text-cash underline underline-offset-2"
                >
                  Apni asli dukaan banayein →
                </button>
              )}
            </div>
          </div>
          {editingProfile && !helperMode && (
            <form
              className="surface-card mt-2 space-y-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void act("profile", async () => {
                  await api("/api/shop/profile", {
                    json: {
                      name: shopNameInput.trim(),
                      city: shopCityInput.trim() || null,
                      phone: shopPhoneInput.trim() || null,
                    },
                  });
                  await Promise.all([reloadShops(), refresh()]);
                  setEditingProfile(false);
                  toast("Dukaan ki maloomat save ho gayin ✓", "ok");
                });
              }}
            >
              <input value={shopNameInput} onChange={(e) => setShopNameInput(e.target.value)} placeholder="Dukaan ka naam" required className="h-10 w-full rounded-[10px] bg-canvas px-3 text-[14.5px] font-medium outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <input value={shopCityInput} onChange={(e) => setShopCityInput(e.target.value)} placeholder="City / Area" className="h-10 w-full rounded-[10px] bg-canvas px-3 text-[14px] outline-none" />
                <input value={shopPhoneInput} onChange={(e) => setShopPhoneInput(e.target.value)} placeholder="Phone (03xx…)" inputMode="tel" className="h-10 w-full rounded-[10px] bg-canvas px-3 text-[14px] outline-none" />
              </div>
              <PrimaryButton type="submit" busy={busy === "profile"} disabled={!shopNameInput.trim()} className="h-10 w-full text-[14px]">
                Save Shop Details
              </PrimaryButton>
            </form>
          )}
        </section>

        <AppLockSection />

        {/* Helper / Family Restricted Mode */}
        <section>
          <div className="section-label mb-2">Helper / Family Mode</div>
          <button
            type="button"
            onClick={() => {
              const next = !helperMode;
              setHelperMode(next);
              toast(next ? "Helper Mode ON — munafa aur cost ab chhupa hai" : "Owner Mode wapas ON", "info");
            }}
            className="tactile flex h-11 w-full items-center justify-between rounded-[12px] bg-surface px-3.5 text-[13.5px] font-medium"
          >
            <span>Munafa, cost aur settings chhupayein</span>
            <Pill tone={helperMode ? "amber" : "neutral"}>{helperMode ? "ON" : "OFF"}</Pill>
          </button>
        </section>

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
            {state && (
              <button
                type="button"
                onClick={() => {
                  const text = eodSummaryText({
                    shop: state.shop.name,
                    cash_sales_paisa: state.today.cash_sales_paisa,
                    udhaar_paisa: state.today.udhaar_paisa,
                    wasooli_paisa: state.today.wasooli_paisa,
                    cash_in_galla_paisa: state.today.cash_in_galla_paisa,
                    sales_count: state.today.sales_count,
                  });
                  window.open(waLink(null, text), "_blank", "noopener,noreferrer");
                }}
                className="tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] bg-cash-bg text-[13.5px] font-semibold text-cash-ink"
              >
                Share Aaj Ka Hisaab (WhatsApp)
              </button>
            )}
          </div>
        </section>

        {/* Raast / Wallet ID for Mutual Khata */}
        <section>
          <div className="section-label mb-2">Raast / EasyPaisa / JazzCash ID</div>
          <form
            className="surface-card flex gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act("raast", async () => {
                await api("/api/khata/raast", { json: { raast_id: raastId.trim() || null } });
                toast(raastId.trim() ? "Raast ID saved — Mutual Khata par dikhega" : "Raast ID cleared", "ok");
              });
            }}
          >
            <input
              value={raastId}
              onChange={(e) => setRaastId(e.target.value)}
              placeholder="03xx-xxxxxxx ya IBAN"
              className="h-11 min-w-0 flex-1 rounded-[12px] bg-canvas px-3 text-[14.5px] outline-none"
            />
            <button type="submit" disabled={busy === "raast"} className="tactile h-11 shrink-0 rounded-[12px] bg-ink px-4 text-[14px] font-semibold text-white disabled:opacity-50">
              {busy === "raast" ? <Spinner /> : "Save"}
            </button>
          </form>
        </section>

        {!helperMode && (
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
        )}

        <button onClick={() => void signOut()} className="tactile flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-surface text-[14px] font-semibold text-udhaar-ink">
          <LogOut size={15} strokeWidth={SW} /> {tr("signOut", lang)}
        </button>

        {/* Collapsed by default so normal shopkeepers never see dev/export/audit clutter */}
        {(!helperMode || xrayOn) && (
          <button
            type="button"
            onClick={() => setShowDevTools((v) => !v)}
            className="tactile flex h-10 w-full items-center justify-between rounded-[12px] px-3 text-[12.5px] font-medium text-ink-3"
          >
            <span className="flex items-center gap-1.5"><Code2 size={14} strokeWidth={SW} /> {xrayOn ? "Advanced · Backup & Developer Tools" : "Backup, Sync & Hisaab Check"}</span>
            {showDevTools ? <ChevronUp size={15} strokeWidth={SW} /> : <ChevronDown size={15} strokeWidth={SW} />}
          </button>
        )}

        {showDevTools && (
          <div className="space-y-4 border-t border-black/10 pt-3">
            <section>
              <div className="section-label mb-2">Backup &amp; CSV</div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
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
                    className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] bg-surface-sunken text-[13px] font-semibold"
                  >
                    {busy === "export" ? <Spinner /> : <Download size={14} strokeWidth={SW} />} {tr("exportData", lang)}
                  </button>
                  <button
                    onClick={() =>
                      void act("audit", async () => {
                        const bundle = await api<Record<string, unknown>>("/api/shop/audit-bundle");
                        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `dukaanos-audit-proof-${new Date().toISOString().slice(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast("Signed Audit Bundle exported", "ok");
                      })
                    }
                    className="tactile flex h-11 items-center justify-center gap-1.5 rounded-[12px] bg-cash-bg text-[13px] font-semibold text-cash-ink"
                  >
                    {busy === "audit" ? <Spinner /> : <ShieldCheck size={14} strokeWidth={SW} />} Signed Audit Bundle
                  </button>
                </div>
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
                <input
                  ref={csvRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    void act("import", async () => {
                      const list = parseCustomerCsv(await f.text());
                      if (list.length === 0) throw new Error("CSV mein koi customer nahi mila");
                      let added = 0;
                      for (const c of list.slice(0, 100)) {
                        await api("/api/shop/customer", { json: { name: c.name, phone: c.phone ?? undefined } });
                        added++;
                      }
                      await refresh();
                      toast(`${added} customers import ho gaye`, "ok");
                    });
                  }}
                />
                <input
                  ref={prodCsvRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    void act("import-prod", async () => {
                      const list = parseProductCsv(await f.text());
                      if (list.length === 0) throw new Error("CSV mein koi item nahi mila");
                      let added = 0;
                      for (const p of list.slice(0, 100)) {
                        await api("/api/shop/product", { json: p });
                        added++;
                      }
                      await refresh();
                      toast(`${added} items Maal mein import ho gaye`, "ok");
                    });
                  }}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => csvRef.current?.click()}
                    disabled={busy === "import"}
                    className="tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] bg-surface-sunken text-[12.5px] font-semibold"
                  >
                    {busy === "import" ? <Spinner /> : <Upload size={13} strokeWidth={SW} />} Import Customers CSV
                  </button>
                  <button
                    onClick={() => prodCsvRef.current?.click()}
                    disabled={busy === "import-prod"}
                    className="tactile flex h-10 items-center justify-center gap-1.5 rounded-[12px] bg-surface-sunken text-[12.5px] font-semibold"
                  >
                    {busy === "import-prod" ? <Spinner /> : <Upload size={13} strokeWidth={SW} />} Import Products CSV
                  </button>
                </div>
              </div>
            </section>

            <section>
              <div className="section-label mb-2">Offline Queue &amp; Storage</div>
              <div className="surface-card space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <Pill tone={pending ? "amber" : "cash"}>{pending} queued</Pill>
                    {storageInfo && <div className="mt-1 text-[11.5px] text-ink-2">Device storage: {storageInfo}</div>}
                  </div>
                  <button onClick={() => void act("flush", flush)} className="tactile flex h-8 items-center gap-1.5 rounded-full bg-surface-sunken px-3 text-[13px] font-semibold">
                    {busy === "flush" ? <Spinner /> : <RefreshCw size={13} strokeWidth={SW} />} Sync now
                  </button>
                </div>
                <button onClick={() => setSimulatedOffline(!simulatedOffline)} className={cx("tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] text-[14px] font-semibold", simulatedOffline ? "bg-amber-bg text-amber-ink" : "bg-surface-sunken")}>
                  <WifiOff size={15} strokeWidth={SW} /> Simulate Offline: {simulatedOffline ? "ON" : "OFF"}
                </button>
                {queuedCommits.map((c) => (
                  <div key={c.idempotency_key} className="space-y-1 rounded-[10px] bg-canvas p-2.5 text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{c.optimistic.label}</span>
                      <Pill tone={c.status === "failed" ? "udhaar" : "amber"}>{c.status}</Pill>
                      {c.status === "failed" && (
                        <button type="button" onClick={() => void retryCommit(c.idempotency_key)} className="tactile font-semibold text-cash">
                          Retry
                        </button>
                      )}
                      <button type="button" aria-label="Discard commit" onClick={() => void discardCommit(c.idempotency_key)} className="grid h-7 w-7 place-items-center text-ink-3">
                        <Trash2 size={13} strokeWidth={SW} />
                      </button>
                    </div>
                    {c.last_error && <div className="text-[11.5px] text-udhaar-ink">{c.last_error}</div>}
                  </div>
                ))}
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
              <div className="section-label mb-2">Developer &amp; Judge Proof Tools</div>
              <div className="surface-card space-y-2.5 p-4">
                <button
                  type="button"
                  onClick={() => setXrayOn(!xrayOn)}
                  className="tactile flex h-10 w-full items-center justify-between rounded-[12px] bg-surface-sunken px-3.5 text-[13.5px] font-semibold"
                >
                  <span className="font-mono">{"</>"} X-Ray Inspector Mode</span>
                  <Pill tone={xrayOn ? "cash" : "neutral"}>{xrayOn ? "ON" : "OFF"}</Pill>
                </button>
                <button
                  onClick={() => void act("chain", async () => setChain(await api("/api/shop/chain")))}
                  className="tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[14px] font-semibold"
                >
                  {busy === "chain" ? <Spinner /> : <ShieldCheck size={15} strokeWidth={SW} />} {xrayOn ? "Verify SHA-256 chain" : "Hisaab Check Karein"}
                </button>
                {chain && (
                  <div className={cx("rounded-[10px] px-3 py-2 text-[12px]", xrayOn && "font-mono", chain.ok ? "bg-cash-bg text-cash-ink" : "bg-udhaar-bg text-udhaar-ink")}>
                    {xrayOn
                      ? (chain.ok ? `CHAIN_OK · ${chain.checked} links · ${chain.ms}ms` : `CHAIN_BROKEN at #${chain.first_broken_seq} (${chain.code})`)
                      : (chain.ok ? `Sab ${chain.checked} entries bilkul durust hain ✓` : `Entry #${chain.first_broken_seq} mein farq mila`)}
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
                  </>
                )}
                <button onClick={() => openSheet({ type: "replays" })} className="tactile flex h-10 w-full items-center justify-center gap-2 rounded-[12px] bg-surface-sunken text-[14px] font-semibold">
                  <Play size={14} strokeWidth={SW} /> Real-audio replay library
                </button>
              </div>
            </section>

            <section>
              <div className="section-label mb-2">System Health Audit</div>
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
          </div>
        )}
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
