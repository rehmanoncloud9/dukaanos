import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — DukaanOS",
  description: "Plain-language terms of service for DukaanOS.",
};

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-[680px] px-5 py-10 text-ink">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-[14px] font-semibold text-ink-2 underline underline-offset-4">
          ← Back to DukaanOS
        </Link>
        <span className="rounded-full bg-amber-bg px-2.5 py-1 text-[11.5px] font-semibold text-amber-ink">
          Draft — Marked for Legal Review
        </span>
      </div>

      <article className="surface-card space-y-5 p-6">
        <header>
          <div className="section-label">DukaanOS · Terms of Service</div>
          <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em]">Terms of Use</h1>
          <p className="urdu-read mt-2 text-right text-ink" dir="rtl">
            دکان او ایس صرف دکاندار کے ذاتی حساب کتاب اور ریکارڈ کے لیے ہے۔
          </p>
        </header>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">1. Ledger &amp; Bookkeeping Tool</h2>
          <p>
            DukaanOS is a digital khata and inventory assistant for shopkeepers. You remain responsible for reviewing entries, customer balances, and wholesale parchi totals before confirming.
          </p>
        </section>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">2. Private Record &amp; Non-Financial-Advice</h2>
          <p>
            DukaanOS has <strong>no linkage</strong> to tax authorities and does not provide tax, legal, accounting, or Shariah rulings. Trade Summaries are owner-consented informational summaries only, not credit underwriting or lending offers.
          </p>
        </section>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">3. Offline Sync &amp; Fair Use</h2>
          <p>
            Entries recorded offline are stored safely on your device and synced automatically without duplicates when connectivity returns. Automated abuse or scraping of AI endpoints is prohibited and rate-limited.
          </p>
        </section>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">4. Account Termination</h2>
          <p>
            You may stop using DukaanOS and delete your account and sole-owner shop data at any time via{" "}
            <Link href="/delete-account" className="font-semibold text-ink underline underline-offset-4">
              /delete-account
            </Link>
            .
          </p>
        </section>

        <footer className="hairline-t pt-4 text-[13px] text-ink-2">
          Questions? <span className="font-mono">support@dukaanos.pk</span> ·{" "}
          <Link href="/privacy" className="underline underline-offset-4">
            Privacy Policy
          </Link>
        </footer>
      </article>
    </main>
  );
}
