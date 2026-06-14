import { redirect } from "@/i18n/navigation";
import { legacyAshedRedirect } from "@/lib/nav/routes";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ locale: string; path?: string[] }>;
};

export default async function LegacyAshedPage({ params }: Props) {
  const { locale, path = [] } = await params;
  const target = legacyAshedRedirect(path);
  if (!target) {
    notFound();
  }
  redirect({ href: target, locale });
}
