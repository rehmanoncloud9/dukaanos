"use client";

import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, friendlyError } from "@/lib/client/api";
import { browserSupabase, supabaseConfigured } from "@/lib/client/supabase";

export default function DeleteAccountPage() {
  const configured = supabaseConfigured();
  const [email, setEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!configured) return;
    const sb = browserSupabase();
    sb.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setEmail(s?.user.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, [configured]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const { error } = await browserSupabase().auth.signInWithPassword({ email: loginEmail, password: loginPin });
      if (error) throw new Error(error.message);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api("/api/account/delete", { method: "POST", json: { confirm: true }, shop: false });
      await browserSupabase().auth.signOut();
      localStorage.removeItem("dukaanos.shop");
      setDone(true);
    } catch (ex) {
      setErr(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-dvh max-w-[460px] px-5 py-10 text-ink">
      <div className="mb-6">
        <Link href="/" className="text-[14px] font-semibold text-ink-2 underline underline-offset-4">
          ← Back to DukaanOS
        </Link>
      </div>

      <div className="surface-card space-y-4 p-6">
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-udhaar-bg text-udhaar-ink">
            <Trash2 size={18} strokeWidth={1.75} />
          </div>
          <div>
            <div className="section-label">Account &amp; Data Deletion</div>
            <h1 className="text-[20px] font-bold tracking-[-0.02em]">Delete DukaanOS Account</h1>
          </div>
        </div>

        {done ? (
          <div className="space-y-3 rounded-[14px] bg-cash-bg p-4 text-cash-ink">
            <div className="flex items-center gap-2 text-[15px] font-bold">
              <CheckCircle2 size={18} strokeWidth={1.75} /> Account &amp; shop data deleted
            </div>
            <p className="text-[13.5px] leading-5">
              Your DukaanOS user account, memberships, and sole-owner shop ledger data have been permanently deleted.
            </p>
            <Link href="/" className="tactile inline-flex h-11 w-full items-center justify-center rounded-[12px] bg-ink text-[14px] font-semibold text-white">
              Return to Home
            </Link>
          </div>
        ) : (
          <>
            <div className="rounded-[12px] bg-amber-bg p-3.5 text-[13.5px] leading-5 text-amber-ink">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle size={15} strokeWidth={1.75} /> Permanent Action
              </div>
              <p className="mt-1">
                Deleting your account permanently removes your profile, shop memberships, and any sole-owner shop ledger, customers, and products. This cannot be undone.
              </p>
            </div>

            {err && (
              <div role="alert" className="rounded-[12px] bg-udhaar-bg px-3.5 py-2.5 text-[13.5px] font-medium text-udhaar-ink">
                {err}
              </div>
            )}

            {!email ? (
              <form onSubmit={signIn} className="space-y-2.5">
                <p className="text-[13.5px] text-ink-2">Sign in to confirm ownership of the account you want to delete:</p>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="Email"
                  className="h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none"
                />
                <input
                  type="password"
                  required
                  value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value)}
                  placeholder="PIN / Password"
                  className="h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="tactile h-12 w-full rounded-[14px] bg-ink text-[15px] font-semibold text-white disabled:opacity-40"
                >
                  {busy ? "Signing in…" : "Sign in to continue"}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="rounded-[12px] bg-canvas px-3.5 py-2.5 text-[13.5px]">
                  Signed in as <span className="font-semibold">{email}</span>
                </div>
                <label className="block text-[13px] font-medium text-ink-2">
                  Type <span className="font-mono font-bold text-ink">DELETE</span> to confirm permanent deletion:
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="DELETE"
                    className="mt-1.5 h-11 w-full rounded-[12px] bg-canvas px-3 font-mono text-[15px] text-ink outline-none"
                  />
                </label>
                <button
                  onClick={() => void handleDelete()}
                  disabled={busy || confirmText.trim().toUpperCase() !== "DELETE"}
                  className="tactile h-12 w-full rounded-[14px] bg-udhaar text-[15px] font-semibold text-white disabled:opacity-40"
                >
                  {busy ? "Deleting…" : "Permanently Delete My Account"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
