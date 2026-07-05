import type { Metadata } from "next";
import { serif, sans, mono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echo Intelligence — Operator",
  description: "Live scripture-detection control panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
