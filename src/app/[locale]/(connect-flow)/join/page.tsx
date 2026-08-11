import { JoinCodeClient } from "@/components/auth/JoinCodeClient";
import { standalonePageMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";
import { requireAuthForPage } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("join");
  return standalonePageMetadata(t("title"));
}
type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function JoinPage({ searchParams }: Props) {
  await requireAuthForPage("/join");
  const { code } = await searchParams;
  return <JoinCodeClient initialCode={code?.trim()} />;
}
