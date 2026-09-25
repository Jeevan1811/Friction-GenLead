import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "driver.js/dist/driver.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "Friction GenLead",
  description: "Queensland business prospecting system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" className={geist.variable}>
      <body style={{ fontFamily: "var(--font-sans)" }}>{children}</body>
    </html>
  );
}
