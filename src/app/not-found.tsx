import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { hasSignedInAppSession } from "@/lib/session/has-signed-in-app-session.server";

/**
 * Unmatched routes that render outside `[locale]/layout` (no html/body from locale shell).
 */
export default async function RootNotFoundPage() {
  const t = await getTranslations("httpErrors");
  const signedIn = await hasSignedInAppSession();

  return (
    <html lang="en-US">
      <body className="min-h-screen bg-[#0d1117] text-[#e6edf3] antialiased">
        <div className="flex min-h-screen items-center justify-center px-4 py-10">
          <div className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
            <h1 className="text-xl font-semibold">{t("notFoundTitle")}</h1>
            <p className="text-sm text-[#8b949e]">{t("notFoundBody")}</p>
            <p className="text-xs text-[#6e7681]">
              {signedIn ? t("notFoundHintSignedIn") : t("notFoundHint")}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <Link
                href="/"
                className="w-full rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-center text-sm font-medium text-white"
              >
                {t("goHome")}
              </Link>
              <Link
                href={signedIn ? "/inbox" : "/auth"}
                className="text-center text-sm text-[#58a6ff] hover:underline"
              >
                {signedIn ? t("goInbox") : t("goSignIn")}
              </Link>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
