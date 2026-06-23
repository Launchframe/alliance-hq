import { getTranslations } from "next-intl/server";

import { LandingPage } from "@/components/marketing/LandingPage";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

export default async function PublicHomePage({ params }: Props) {
  const { locale } = await params;
  const session = await auth();

  if (session?.user?.email) {
    redirect({ href: "/dashboard", locale });
  }

  return <LandingPage />;
}
