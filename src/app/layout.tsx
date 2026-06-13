import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-family",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Alliance HQ",
    template: "%s · Alliance HQ",
  },
  description:
    "Alliance tools for Last War — built on ashed.online with video upload and more.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://alliance-hq.online",
  ),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
