"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { formatAmount } from "@/lib/domain/money";

export const SW = 1.75; // lucide strokeWidth lock

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

/** "Rs. 1,400" with the muted Rs. prefix and tabular numerals. */
export function Money({ paisa, className, sign, prefixClass }: { paisa: number; className?: string; sign?: boolean; prefixClass?: string }) {
  const neg = paisa < 0;
  return (
    <span className={cx("num whitespace-nowrap", className)}>
      {neg ? "-" : sign ? "+" : ""}
      <span className={cx("rs-prefix", prefixClass)}>Rs.</span>
      {formatAmount(Math.abs(paisa))}
    </span>
  );
}

export function Pill({ children, tone = "neutral", className, onClick, mono }: { children: ReactNode; tone?: "neutral" | "cash" | "udhaar" | "maal" | "dark" | "amber" | "outline"; className?: string; onClick?: () => void; mono?: boolean }) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-sunken text-ink-2",
    cash: "bg-cash-bg text-cash-ink",
    udhaar: "bg-udhaar-bg text-udhaar-ink",
    maal: "bg-maal-bg text-maal border border-maal/20",
    dark: "bg-ink text-white",
    amber: "bg-amber-bg text-amber-ink",
    outline: "bg-surface text-ink border border-black/15",
  };
  const cls = cx("inline-flex items-center gap-1 rounded-full px-2.5 h-6 text-[12px] font-semibold", mono && "font-mono text-[11px]", tones[tone], onClick && "tactile", className);
  return onClick ? (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent spin", className)} aria-hidden />;
}

export function Sheet({ open, onClose, children, title, right, className }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode; right?: ReactNode; className?: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      first?.focus();
    }
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && panel) {
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
      <button aria-label="Close" className="absolute inset-0 bg-black/35 scrim-in" onClick={onClose} />
      <div ref={panelRef} className={cx("relative flex max-h-[86dvh] w-full max-w-[414px] flex-col rounded-t-[24px] sm:rounded-[24px] bg-surface sheet-in shadow-[0_20px_60px_rgba(0,0,0,0.28)]", className)}>
        <div className="flex justify-center pb-1 pt-2">
          <span className="h-1 w-9 rounded-full bg-black/15" />
        </div>
        {(title || right) && (
          <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-2">
            <div id={titleId} className="min-w-0 flex-1 truncate text-[18px] font-bold tracking-[-0.02em]">{title}</div>
            {right ?? (
              <button onClick={onClose} className="tactile grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-sunken" aria-label="Close">
                <X size={16} strokeWidth={SW} />
              </button>
            )}
          </div>
        )}
        <div className="no-scrollbar flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="grid h-[34px] rounded-[10px] bg-surface-sunken p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx("rounded-[8px] text-[13px] font-semibold transition-colors", value === o.value ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12)]" : "text-ink-2")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PrimaryButton({ children, onClick, disabled, busy, tone = "ink", className, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; tone?: "ink" | "maal" | "cash"; className?: string; type?: "button" | "submit" }) {
  const bg = tone === "maal" ? "bg-maal" : tone === "cash" ? "bg-cash" : "bg-ink";
  return (
    <button type={type} onClick={onClick} disabled={disabled || busy} className={cx("tactile flex h-12 items-center justify-center gap-2 rounded-[14px] px-4 text-[16px] font-semibold text-white disabled:opacity-40", bg, className)}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, className, disabled }: { children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cx("tactile h-12 rounded-[14px] bg-surface-sunken px-4 text-[15px] font-semibold text-ink disabled:opacity-40", className)}>
      {children}
    </button>
  );
}

export function relTime(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - d) / 1000);
  if (s < 90) return "ابھی";
  if (s < 3600) return `${Math.round(s / 60)} منٹ پہلے`;
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("ur-PK", { hour: "numeric", minute: "2-digit" });
  return date.toLocaleDateString("ur-PK", { day: "numeric", month: "short" });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ur-PK", { day: "numeric", month: "short" });
}
