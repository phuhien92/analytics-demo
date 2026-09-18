import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Golden Analytics",
  description: "Analytics that shows its work.",
};

/** Minimal shell. GA-10 replaces the body with the approved ask surface. */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
