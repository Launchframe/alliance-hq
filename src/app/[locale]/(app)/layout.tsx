import { getLocale, getTranslations } from "next-intl/server";

import { TimezoneProvider } from "@/components/timezone/TimezoneProvider";
import { redirect } from "@/i18n/navigation";
import { AshedShell } from "@/components/ashed-shell/AshedShell";
import { requireAuthForPage } from "@/lib/auth/page-guard";
import {
  collectDatabaseErrorText,
  postgresErrorCode,
  resolveDatabaseErrorPresentation,
} from "@/lib/db/error-message";
import { rethrowNavigationError } from "@/lib/navigation";
import { getPageSessionState } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = await getTranslations("devErrors");

  await requireAuthForPage("/");

  let state;
  try {
    state = await getPageSessionState("/", locale);
  } catch (error) {
    rethrowNavigationError(error);
    console.error("[app-layout] session bootstrap failed:", error);

    const { titleKey, hintKey, devDetail } =
      resolveDatabaseErrorPresentation(error);
    const pgCode = postgresErrorCode(error);

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d1117] p-6 text-[#e6edf3]">
        <div className="max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6 text-center">
          <h1 className="text-lg font-semibold">{t(titleKey)}</h1>
          <p className="mt-2 text-sm text-[#8b949e]">
            {devDetail ??
              t.rich(hintKey, {
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
                pgCode: () => (
                  <code className="text-[#58a6ff]">{pgCode ?? "unknown"}</code>
                ),
              })}
          </p>
          {process.env.NODE_ENV === "development" && devDetail ? (
            <p className="mt-3 break-all text-left font-mono text-xs text-[#6e7681]">
              {collectDatabaseErrorText(error).slice(0, 1200)}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!state.hasAppAccess) {
    redirect({ href: "/get-started", locale });
  }

  return (
    <TimezoneProvider initialTimezoneId={state.timezone}>
      <AshedShell
        sessionId={state.sessionId}
        userLabel={state.userLabel}
        displayName={state.rbac?.displayName ?? null}
        userEmail={state.rbac?.email ?? null}
        avatarUrl={state.rbac?.avatarUrl ?? null}
        isConnected={state.isConnected}
        hasAppAccess={state.hasAppAccess}
        isNativeAlliance={state.isNativeAlliance}
        operatingMode={state.operatingMode}
        canUseAshedEmbeds={state.canUseAshedEmbeds}
        ashed={state.ashed}
        showAdminPortal={state.rbac?.isPlatformMaintainer ?? false}
        showTeamAccess={state.showTeamAccess}
        currentAllianceId={
          state.currentAllianceId ?? state.allianceId ?? null
        }
        membershipAlliances={state.membershipAlliances}
        sessionPermissions={state.permissions}
      >
        {children}
      </AshedShell>
    </TimezoneProvider>
  );
}
