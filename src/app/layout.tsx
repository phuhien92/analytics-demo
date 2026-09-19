import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "./globals.css";

/**
 * The approved typefaces, not the CLI's.
 *
 * `shadcn init` wired Geist in here. `design-system/styles.css` declares IBM Plex Sans
 * and IBM Plex Mono, and the design system is the theme (`docs/architecture.md` §10),
 * so those are what load. `next/font/google` rather than the design system's own
 * `@import url(...)`: the import is a render-blocking round trip to a third party on
 * every page load, while `next/font` self-hosts the files and hands back a class that
 * fills `--font-ibm-plex-sans`, which `globals.css` reads as `--font-sans`.
 *
 * Weight 450 is the design system's body weight and is not one of the static cuts, so
 * the variable font is requested across 400–600 and `font-variation-settings` resolves
 * it.
 */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Golden Analytics",
  description: "Analytics that shows its work.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
