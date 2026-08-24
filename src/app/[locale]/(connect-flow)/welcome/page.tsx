import { redirect } from "next/navigation";
import { standalonePageMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { getTranslations } from "next-intl/server";

import { resolveWelcomeRedirect } from "@/lib/native-alliance/welcome-redirect.shared";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("metadata");
  return standalonePageMetadata(t("pages.welcome"));
}
type Props = {
  searchParams: Promise<{
    tag?: string;
    code?: string;
    invite?: string;
    p?: string;
  }>;
};

/**
 * Recipient entry for share links built by PR #210 (`/welcome?tag=&code=` /
 * `/welcome?invite=` / `/welcome?invite=&p=`). Bridges to existing /join and
 * /invite flows.
 */
export default async function WelcomePage({ searchParams }: Props) {
  const params = await searchParams;
  redirect(
    resolveWelcomeRedirect({
      tag: params.tag,
      code: params.code,
      invite: params.invite,
      p: params.p,
    }),
  );
}
