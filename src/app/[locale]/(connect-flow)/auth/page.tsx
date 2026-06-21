import { AuthSignInClient } from "@/components/auth/AuthSignInClient";
import { sanitizeInternalRedirectPath } from "@/lib/navigation/safe-redirect.shared";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ callbackUrl?: string; email?: string }>;
};

export default async function AuthPage({ searchParams }: Props) {
  const { callbackUrl, email } = await searchParams;
  const safeCallback = sanitizeInternalRedirectPath(callbackUrl) ?? callbackUrl;

  return (
    <AuthSignInClient
      callbackUrl={safeCallback}
      presetEmail={email?.trim() || undefined}
    />
  );
}
