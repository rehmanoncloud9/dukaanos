import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col items-center justify-center px-6 text-center">
      <div className="surface-card w-full p-6">
        <div className="font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-2">404 · Not Found</div>
        <h1 className="mt-2 text-[24px] font-bold tracking-[-0.02em] text-ink">Yeh safha nahi mila</h1>
        <p className="mt-1.5 text-[14px] leading-5 text-ink-2">
          The page you requested does not exist. Return to your counter or verify an SMEConnect Trade Passport.
        </p>
        <div className="mt-5 flex gap-2.5">
          <Link
            href="/verify"
            className="tactile flex h-12 flex-1 items-center justify-center rounded-[14px] bg-surface-sunken text-[15px] font-semibold text-ink"
          >
            /verify
          </Link>
          <Link
            href="/"
            className="tactile flex h-12 flex-1 items-center justify-center rounded-[14px] bg-ink text-[15px] font-semibold text-white"
          >
            Open Munshi
          </Link>
        </div>
      </div>
    </main>
  );
}
