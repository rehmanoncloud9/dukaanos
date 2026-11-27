"use client";

import { Lock, Mail, Store, UserRound } from "lucide-react";
import { useState } from "react";
import { useDukaan } from "@/lib/client/store";
import { PrimaryButton, SecondaryButton, Spinner, SW } from "./ui";

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#0A0A0A" />
      <path d="M14 26h36l-3 22a4 4 0 0 1-4 3.5H21a4 4 0 0 1-4-3.5z" fill="#fff" />
      <path d="M22 26a10 10 0 0 1 20 0" stroke="#047857" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M26 38h12" stroke="#0A0A0A" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function TrustBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-cash-bg px-3 py-1.5 text-[13px] font-semibold text-cash-ink">
      <Lock size={12} strokeWidth={SW} /> Sirf Aap Ka Record — Zero FBR Linkage
    </div>
  );
}

/** Flow 1 — zero CNIC, zero tax fields. */
export function Splash() {
  const { signInSandbox, signInPassword, signInMagic, verifyEmailOtp, signInPhoneOtp, verifyPhoneOtp, toast } = useDukaan();
  const [mode, setMode] = useState<"none" | "stage" | "magic" | "phone">("none");
  const [email, setEmail] = useState("stage@dukaanos.pk");
  const [emailOtp, setEmailOtp] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sign-in failed", "err");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-6 pb-8 pt-16">
      <Logo size={64} />
      <h1 className="mt-6 text-[34px] font-bold leading-[38px] tracking-[-0.03em]">DukaanOS</h1>
      <p className="mt-2 text-[17px] leading-6 text-ink-2">Bolo, parchi dikhao — munshi hisaab likh dega. Voice &amp; parchi → pakka khata.</p>
      <p className="urdu-read mt-1 text-right text-ink" dir="rtl">آپ بولیں، منشی حساب لکھے گا</p>
      <div className="mt-4">
        <TrustBadge />
      </div>

      <div className="mt-auto space-y-3 pt-10">
        <PrimaryButton
          tone="cash"
          className="h-14 w-full text-[17px]"
          busy={busy === "sandbox"}
          onClick={() => void run("sandbox", () => signInSandbox())}
        >
          <Store size={18} strokeWidth={SW} /> Try Live Demo Shop
        </PrimaryButton>
        <p className="-mt-1 text-center text-[12.5px] text-ink-2">Demo dukaan — bina account ke check karein</p>

        {mode === "stage" ? (
          <form
            className="space-y-2 rounded-[16px] bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("stage", () => signInPassword(email, pin));
            }}
          >
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
            <input value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric" placeholder="PIN / password" className="h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
            <PrimaryButton type="submit" className="w-full" busy={busy === "stage"} disabled={!pin}>
              Open stage shop
            </PrimaryButton>
          </form>
        ) : mode === "phone" ? (
          <form
            className="space-y-2 rounded-[16px] bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("phone", async () => {
                if (!otpSentTo) {
                  const normalized = await signInPhoneOtp(phone);
                  setOtpSentTo(normalized);
                  toast(`OTP bhej diya: ${normalized}`, "ok");
                } else {
                  await verifyPhoneOtp(otpSentTo, otp);
                }
              });
            }}
          >
            {!otpSentTo ? (
              <>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="03xx-xxxxxxx" className="h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
                <PrimaryButton type="submit" className="w-full" busy={busy === "phone"} disabled={phone.trim().length < 10}>
                  Send SMS OTP
                </PrimaryButton>
                <button type="button" onClick={() => setMode("magic")} className="block w-full py-1 text-center text-[12.5px] font-semibold text-ink-2 underline underline-offset-4">
                  Use email magic link instead
                </button>
              </>
            ) : (
              <>
                <div className="text-[12.5px] text-ink-2">OTP sent to {otpSentTo}</div>
                <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit OTP" className="num h-11 w-full rounded-[12px] bg-canvas px-3 text-[16px] tracking-[0.25em] outline-none" />
                <PrimaryButton type="submit" className="w-full" busy={busy === "phone"} disabled={otp.length < 4}>
                  Verify & Open Shop
                </PrimaryButton>
              </>
            )}
          </form>
        ) : mode === "magic" ? (
          <form
            className="space-y-2 rounded-[16px] bg-surface p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run("magic", async () => {
                if (!sent) {
                  await signInMagic(email);
                  setSent(true);
                  toast("Verification code & link bhej diya — inbox check karein", "ok");
                } else {
                  await verifyEmailOtp(email, emailOtp);
                }
              });
            }}
          >
            {sent ? (
              <>
                <p className="text-[13px] text-cash-ink">Code bhej diya — {email} check karein (ya magic link click karein).</p>
                <input
                  value={emailOtp}
                  onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  placeholder="6-digit verification code"
                  className="num h-11 w-full rounded-[12px] bg-canvas px-3 text-[16px] tracking-[0.25em] outline-none"
                />
                <PrimaryButton type="submit" className="w-full" busy={busy === "magic"} disabled={emailOtp.length < 6}>
                  Verify & Open Shop
                </PrimaryButton>
                <button type="button" onClick={() => { setSent(false); setEmailOtp(""); }} className="block w-full py-1 text-center text-[12.5px] font-semibold text-ink-2 underline underline-offset-4">
                  Change email / resend code
                </button>
              </>
            ) : (
              <>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="aap@email.com" className="h-11 w-full rounded-[12px] bg-canvas px-3 text-[15px] outline-none" />
                <PrimaryButton type="submit" className="w-full" busy={busy === "magic"} disabled={!email.includes("@")}>
                  Send verification code
                </PrimaryButton>
              </>
            )}
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <SecondaryButton className="flex items-center justify-center gap-2" onClick={() => setMode("stage")}>
              <UserRound size={16} strokeWidth={SW} /> Stage login
            </SecondaryButton>
            <SecondaryButton
              className="flex items-center justify-center gap-2"
              onClick={() => {
                setEmail("");
                setSent(false);
                setEmailOtp("");
                setMode("magic");
              }}
            >
              <Mail size={16} strokeWidth={SW} /> New shop
            </SecondaryButton>
          </div>
        )}
        <a href="/verify" className="block pt-2 text-center text-[13px] font-semibold text-ink-2 underline underline-offset-4">
          Verify an SMEConnect Passport →
        </a>
        <div className="flex items-center justify-center gap-4 pt-1 text-[12px] text-ink-2">
          <a href="/privacy" className="underline underline-offset-4 hover:text-ink-2">Privacy</a>
          <a href="/terms" className="underline underline-offset-4 hover:text-ink-2">Terms</a>
          <a href="/delete-account" className="underline underline-offset-4 hover:text-ink-2">Delete account</a>
        </div>
      </div>
    </main>
  );
}

/** Flow 1(c): first sign-in of a new shopkeeper creates their shop + owner membership. */
export function CreateShop() {
  const { createShop, signOut, toast } = useDukaan();
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [seedStarter, setSeedStarter] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col px-6 pb-8 pt-14">
      <Logo />
      <h1 className="mt-5 text-[28px] font-bold tracking-[-0.02em]">Apni dukaan banayein</h1>
      <p className="mt-1 text-[15px] text-ink-2">No CNIC. No tax number. Only what the khata needs.</p>
      <div className="mt-6 space-y-2.5">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dukaan ka naam (e.g. Madina Store)" className="h-12 w-full rounded-[12px] bg-surface px-3 text-[16px] outline-none" />
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner name" className="h-12 w-full rounded-[12px] bg-surface px-3 text-[16px] outline-none" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" className="h-12 w-full rounded-[12px] bg-surface px-3 text-[16px] outline-none" />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Area / city (e.g. G-9 Markaz)" className="h-12 w-full rounded-[12px] bg-surface px-3 text-[16px] outline-none" />
        <label className="flex cursor-pointer items-center gap-2.5 rounded-[12px] bg-surface px-3 py-2.5 text-[13.5px]">
          <input type="checkbox" checked={seedStarter} onChange={(e) => setSeedStarter(e.target.checked)} className="h-4 w-4 accent-cash" />
          <span>Pakistani Kiryana Starter List (20 items + Urdu aliases)</span>
        </label>
      </div>
      <div className="mt-4">
        <TrustBadge />
      </div>
      <div className="mt-auto space-y-2 pt-8">
        <PrimaryButton
          className="w-full"
          busy={busy}
          disabled={name.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            try {
              await createShop({ name, owner_name: owner || undefined, phone: phone || undefined, city: city || undefined, seed_starter: seedStarter });
            } catch (e) {
              toast(e instanceof Error ? e.message : "Could not create shop", "err");
            } finally {
              setBusy(false);
            }
          }}
        >
          Dukaan kholo
        </PrimaryButton>
        <button onClick={() => void signOut()} className="block w-full py-2 text-center text-[14px] text-ink-2">
          Sign out
        </button>
      </div>
    </main>
  );
}

export function SetupNeeded() {
  return (
    <main className="mx-auto max-w-[430px] px-6 pt-16">
      <Logo />
      <h1 className="mt-5 text-[26px] font-bold">Setup needed</h1>
      <p className="mt-2 text-[15px] text-ink-2">Add Supabase + Gemini keys to <code className="font-mono">.env.local</code> (see <code className="font-mono">.env.example</code>), run <code className="font-mono">npm run db:apply</code> and <code className="font-mono">npm run setup</code>, then restart.</p>
    </main>
  );
}

export function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] items-center justify-center">
      <Spinner className="h-6 w-6 text-ink-2" />
    </main>
  );
}
