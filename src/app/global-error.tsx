"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#F2F2F7", color: "#0A0A0A", fontFamily: "system-ui, -apple-system, sans-serif", margin: 0 }}>
        <main style={{ maxWidth: 430, margin: "0 auto", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 16, padding: 24, width: "100%", textAlign: "center" }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>DukaanOS — App Error</h1>
            <p style={{ fontSize: 14, color: "#52525B", marginTop: 8, lineHeight: 1.45 }}>
              Kuch ghalat ho gaya. Aap ka khata aur offline queue mehfooz hai.
            </p>
            {error.digest && <p style={{ fontSize: 11, color: "#71717A", fontFamily: "monospace" }}>Ref: {error.digest}</p>}
            <button
              onClick={reset}
              style={{
                marginTop: 16,
                width: "100%",
                height: 48,
                borderRadius: 14,
                border: "none",
                background: "#0A0A0A",
                color: "#FFFFFF",
                fontSize: 16,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload DukaanOS
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
