import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Noto_Nastaliq_Urdu, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500", "600"] });
const notoArabic = Noto_Sans_Arabic({ variable: "--font-noto-arabic", subsets: ["arabic"], weight: ["600"] });
const nastaliq = Noto_Nastaliq_Urdu({ variable: "--font-nastaliq", subsets: ["arabic"], weight: ["400"] });

export const metadata: Metadata = {
  title: "DukaanOS — Zero-Literacy Financial Compiler",
  description: "Voice + parchi → SHA-256 hash-chained double-entry khata for Pakistan's kiryana stores. Sirf Aap Ka Record — Zero FBR Linkage.",
  applicationName: "DukaanOS",
  appleWebApp: { capable: true, title: "DukaanOS", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#F2F2F7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} ${notoArabic.variable} ${nastaliq.variable} h-full`}>
      <body className="min-h-full bg-canvas text-ink">{children}</body>
    </html>
  );
}
