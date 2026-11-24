import { DukaanApp } from "@/components/AppShell";
import { ServiceWorker } from "@/components/ServiceWorker";

export default function Home() {
  return (
    <>
      <DukaanApp />
      <ServiceWorker />
    </>
  );
}
