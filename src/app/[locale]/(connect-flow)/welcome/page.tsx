import { redirect } from "next/navigation";

import { resolveWelcomeRedirect } from "@/lib/native-alliance/welcome-redirect.shared";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    tag?: string;
    code?: string;
    invite?: string;
  }>;
};

/**
 * Recipient entry for share links built by PR #210 (`/welcome?tag=&code=` /
 * `/welcome?invite=`). Bridges to existing /join and /invite flows.
 */
export default async function WelcomePage({ searchParams }: Props) {
  const params = await searchParams;
  redirect(
    resolveWelcomeRedirect({
      tag: params.tag,
      code: params.code,
      invite: params.invite,
    }),
  );
}
