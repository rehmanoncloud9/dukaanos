import { Suspense } from "react";
import { MutualKhataClient } from "./KhataClient";

export const metadata = {
  title: "Mutual Khata · DukaanOS",
  robots: { index: false, follow: false }, // personal capability link — never indexed
};

/** Server shell; the token is read client-side inside Suspense (Cache Components). */
export default function MutualKhataPage() {
  return (
    <Suspense fallback={<main className="mx-auto min-h-dvh max-w-[430px] px-5 pt-16 text-[15px] text-ink-2">Khata khul raha hai…</main>}>
      <MutualKhataClient />
    </Suspense>
  );
}
