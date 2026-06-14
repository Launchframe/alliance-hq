import { getLocale, getTranslations } from "next-intl/server";

import { TimezoneProvider } from "@/components/timezone/TimezoneProvider";
import { redirect } from "@/i18n/navigation";
import { AshedShell } from "@/components/ashed-shell/AshedShell";
import { rethrowNavigationError } from "@/lib/navigation";
import { getPageSessionState } from "@/lib/session";

export const dynamic = "force-dynamic";

function isDevDatabaseHint(error: unknown, t: Awaited<ReturnType<typeof getTranslations>>): string | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message;
  if (msg.includes("LOCAL_DATABASE_URL") || msg.includes("DATABASE_URL")) {
    return t("localDatabaseUrl");
  }
  if (msg.includes("TOKEN_ENCRYPTION_KEY")) {
    return t("tokenEncryptionKey");
  }
  if (msg.includes('relation "sessions" does not exist')) {
    return t("tablesMissing");
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
    return t("postgresUnreachable");
  }
  if (process.env.NODE_ENV === "development") {
    return msg;
  }
  return null;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = await getTranslations("devErrors");

  let state;
  try {
    state = await getPageSessionState("/", locale);
  } catch (error) {
    rethrowNavigationError(error);
    const hint = isDevDatabaseHint(error, t);
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d1117] p-6 text-[#e6edf3]">
        <div className="max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6 text-center">
          <h1 className="text-lg font-semibold">{t("databaseNotConfigured")}</h1>
          <p className="mt-2 text-sm text-[#8b949e]">
            {hint ??
              t.rich("defaultHint", {
                localDb: (chunks) => (
                  <code className="text-[#58a6ff]">{chunks}</code>
                ),
                encKey: (chunks) => (
                  <code className="text-[#58a6ff]">{chunks}</code>
                ),
                envFile: (chunks) => (
                  <code className="text-[#58a6ff]">{chunks}</code>
                ),
                dbPush: (chunks) => (
                  <code className="text-[#58a6ff]">{chunks}</code>
                ),
              })}
          </p>
        </div>
      </div>
    );
  }

  if (!state.isConnected) {
    redirect({ href: "/connect", locale });
  }

  return (
    <TimezoneProvider initialTimezoneId={state.timezone}>
      <AshedShell
        userLabel={state.userLabel}
        isConnected={state.isConnected}
        ashed={state.ashed}
        showAdminPortal={state.rbac?.isPlatformMaintainer ?? false}
        showTeamSettings={state.rbac?.isAllianceAdmin ?? false}
      >
        {children}
      </AshedShell>
    </TimezoneProvider>
  );
}
