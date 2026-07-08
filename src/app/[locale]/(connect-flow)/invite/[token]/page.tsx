import { auth } from "@/lib/auth";
import { InviteAcceptClient } from "@/components/native-alliance/InviteAcceptClient";
import { getAuthSsoAvailability } from "@/lib/auth/sso-config.server";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { token } = await params;
  const { next } = await searchParams;
  const authSession = await auth();
  const ssoAvailability = getAuthSsoAvailability();

  return (
    <InviteAcceptClient
      token={token}
      queryRedirect={next}
      isAuthenticated={Boolean(authSession?.user?.id && authSession.user.email)}
      userEmail={authSession?.user?.email}
      ssoAvailability={ssoAvailability}
    />
  );
}
