import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — DukaanOS",
  description: "Plain-language privacy policy for DukaanOS (Zero FBR linkage, transient voice/parchi processing, export & deletion rights).",
};

export default function PrivacyPage() {
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
          <div className="section-label">DukaanOS · Privacy Policy</div>
          <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em]">Sirf Aap Ka Record — Your Data, Your Control</h1>
          <p className="urdu-read mt-2 text-right text-ink" dir="rtl">
            آپ کا کھاتہ صرف آپ کی ملکیت ہے۔ آواز اور پرچی کی تصاویر سرور پر محفوظ نہیں کی جاتیں۔
          </p>
        </header>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">1. What we collect</h2>
          <p>
            We store only what your kiryana khata needs: your shop profile (name, city), customer names/phones/tags you add, product catalog, and SHA-256 hash-chained ledger entries. We <strong>never</strong> ask for or collect CNIC numbers, NTN/STRN tax numbers, or bank account credentials.
          </p>
        </section>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">2. Voice &amp; Parchi Photos (Transient Processing)</h2>
          <p>
            Microphone audio clips and wholesale parchi photos are processed <strong>transiently</strong> to extract structured ledger items and are <strong>not stored</strong> on our servers after parsing. Offline clips stay solely in your device&apos;s IndexedDB until synced.
          </p>
        </section>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">3. Sub-processors &amp; Zero Sharing</h2>
          <p>
            We do not sell or share your khata with advertisers, third-party brokers, or tax authorities (<strong>Zero FBR Linkage</strong>). Infrastructure processors used strictly to run the service: <strong>Supabase</strong> (PostgreSQL database &amp; auth) and <strong>Google Gemini API</strong> (transient speech/parchi parsing).
          </p>
        </section>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">4. SMEConnect Trade Passport</h2>
          <p>
            Your Ed25519-signed Trade Passport is generated only when you tap to share it. It is an <strong>informational summary only</strong> — not a credit score, underwriting decision, or tax filing.
          </p>
        </section>

        <section className="space-y-2 text-[14.5px] leading-6 text-ink-2">
          <h2 className="text-[16px] font-bold text-ink">5. Your Rights (Export &amp; Deletion)</h2>
          <p>
            You can export your complete shop data as JSON anytime from <strong>Settings → Export my data</strong>, or permanently delete your account and shop data at{" "}
            <Link href="/delete-account" className="font-semibold text-ink underline underline-offset-4">
              /delete-account
            </Link>
            . Sandbox demo accounts are automatically purged after inactivity.
          </p>
        </section>

        <footer className="hairline-t pt-4 text-[13px] text-ink-2">
          Contact: <span className="font-mono">support@dukaanos.pk</span> · Aligned with Pakistan Personal Data Protection Bill (PDPB) &amp; PECA 2016 principles.
        </footer>
      </article>
    </main>
  );
}
