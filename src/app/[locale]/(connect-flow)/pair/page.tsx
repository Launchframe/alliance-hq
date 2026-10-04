import { PairingLandingClient } from "@/components/credential-pairing/PairingLandingClient";
import { standalonePageMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("deviceLink.landing");
  return standalonePageMetadata(t("title"));
}
type Props = {
  searchParams: Promise<{ code?: string }>;
};

export default async function PairPage({ searchParams }: Props) {
  const { code = "" } = await searchParams;

  return <PairingLandingClient code={code.trim()} />;
}
