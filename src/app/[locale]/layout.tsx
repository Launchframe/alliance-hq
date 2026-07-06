import { NextIntlClientProvider } from "next-intl";
import { SessionProvider } from "next-auth/react";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { hasLocale } from "next-intl";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { JetBrains_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import type { Viewport } from "next";

import { AppearanceProvider } from "@/components/appearance/AppearanceProvider";
import { AppearanceScript } from "@/components/appearance/AppearanceScript";
import { routing } from "@/i18n/routing";
import { PRODUCTION_APP_ORIGIN } from "@/lib/public-site";

import "../globals.css";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-family",
  display: "swap",
});

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: {
      default: t("title"),
      template: t("titleTemplate"),
    },
    description: t("description"),
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? PRODUCTION_APP_ORIGIN,
    ),
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? {
          verification: {
            google: process.env.GOOGLE_SITE_VERIFICATION,
          },
        }
      : {}),
    icons: {
      icon: [{ url: "/brand/hq-icon-app.svg", type: "image/svg+xml" }],
      apple: [{ url: "/brand/hq-icon-app.svg", type: "image/svg+xml" }],
    },
    manifest: "/manifest.webmanifest",
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${jetbrainsMono.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <AppearanceScript />
      </head>
      <body className="min-h-full antialiased">
        <AppearanceProvider>
          <NextIntlClientProvider messages={messages}>
            <SessionProvider>{children}</SessionProvider>
          </NextIntlClientProvider>
        </AppearanceProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
