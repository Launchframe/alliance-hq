import type { Metadata } from "next";

import "./globals.css";

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
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
