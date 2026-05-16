import type { Metadata } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "./Providers";
import Shell from "@/components/Shell";

// Coolvetica — Meru's brand display + body font.
//   Coolvetica Rg     → 400 normal
//   Coolvetica Rg It  → 400 italic
//   Coolvetica Hv Comp→ 700 heavy compressed (display headlines)
// Self-hosted via next/font/local so there's no runtime fetch.
const coolvetica = localFont({
  src: [
    { path: "../fonts/Coolvetica-Rg.otf",       weight: "400", style: "normal" },
    { path: "../fonts/Coolvetica-Rg-It.otf",    weight: "400", style: "italic" },
    { path: "../fonts/Coolvetica-Rg-Cond.otf",  weight: "500", style: "normal" },
    { path: "../fonts/Coolvetica-Hv-Comp.otf",  weight: "700", style: "normal" },
  ],
  variable: "--font-coolvetica",
  display: "swap",
  preload: true,
});

// Inter remains as fallback + numeric-feature provider for tabular hash chips,
// where Coolvetica's character set may not include all the OpenType variants
// (tnum/zero) we rely on. CSS picks Coolvetica first; Inter is the fallback
// when a glyph is missing (e.g., CJK runs, monospace contexts).
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Meru — confidential AI you can audit",
  description:
    "Meru is the trust layer for confidential AI — generating cryptographic receipts that prove how an AI handled private data. Built on 0G with TEE-attested inference, encrypted corpora, and tamper-evident on-chain logs.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    title: "Meru — confidential AI you can audit",
    description:
      "Cryptographic receipts that prove how an AI handled private data. Built on 0G.",
    images: [{ url: "/meru-logo.png", width: 500, height: 500, alt: "Meru" }],
  },
  twitter: {
    card: "summary",
    title: "Meru — confidential AI you can audit",
    description:
      "Cryptographic receipts that prove how an AI handled private data. Built on 0G.",
    images: ["/meru-logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${coolvetica.variable} ${inter.variable}`}
    >
      <body className="h-full">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
