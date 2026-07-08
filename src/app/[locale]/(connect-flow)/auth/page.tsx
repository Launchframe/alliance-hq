import { AuthSignInClient } from "@/components/auth/AuthSignInClient";
import { parseOAuthSignInRequiredSearchParams } from "@/lib/auth/email-sign-in-restriction.shared";
import { getAuthSsoAvailability } from "@/lib/auth/sso-config.server";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    callbackUrl?: string;
    email?: string;
    error?: string;
    providers?: string;
  }>;
};

export default async function AuthPage({ searchParams }: Props) {
  const { callbackUrl, email, error, providers } = await searchParams;
  const safeCallback = sanitizeInternalRedirectPath(callbackUrl) ?? callbackUrl;
  const oauthSignInRequired = parseOAuthSignInRequiredSearchParams({
    error,
    email,
    providers,
  });

  const ssoAvailability = getAuthSsoAvailability();

  return (
    <AuthSignInClient
      callbackUrl={safeCallback}
      presetEmail={email?.trim() || oauthSignInRequired?.email}
      authError={error?.trim() || undefined}
      oauthSignInRequired={oauthSignInRequired}
      ssoAvailability={ssoAvailability}
    />
  );
}
