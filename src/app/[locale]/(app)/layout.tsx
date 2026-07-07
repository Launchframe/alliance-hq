import { getLocale, getTranslations } from "next-intl/server";

import { TimezoneProvider } from "@/components/timezone/TimezoneProvider";
import { redirect } from "@/i18n/navigation";
import { AshedShell } from "@/components/ashed-shell/AshedShell";
import { ShellActivityBoundary } from "@/components/ashed-shell/ShellActivityBoundary";
import { requireAuthForPage } from "@/lib/auth/page-guard";
import {
  collectDatabaseErrorText,
  postgresErrorCode,
  resolveDatabaseErrorPresentation,
} from "@/lib/db/error-message";
import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { rethrowNavigationError } from "@/lib/navigation";
import { getPageSessionState } from "@/lib/session";
import { sessionCanReadAllianceVideoQueue } from "@/lib/video/processor-slots.server";

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
      <div className="flex min-h-screen items-center justify-center bg-hq-canvas p-6 text-hq-fg">
        <div className="max-w-md rounded-xl border border-hq-border bg-hq-surface p-6 text-center">
          <h1 className="text-lg font-semibold">{t(titleKey)}</h1>
          <p className="mt-2 text-sm text-hq-fg-muted">
            {devDetail ??
              t.rich(hintKey, {
                localDb: (chunks) => (
                  <code className="text-hq-accent">{chunks}</code>
                ),
                encKey: (chunks) => (
                  <code className="text-hq-accent">{chunks}</code>
                ),
                envFile: (chunks) => (
                  <code className="text-hq-accent">{chunks}</code>
                ),
                dbPush: (chunks) => (
                  <code className="text-hq-accent">{chunks}</code>
                ),
                pgCode: () => (
                  <code className="text-hq-accent">{pgCode ?? "unknown"}</code>
                ),
              })}
          </p>
          {process.env.NODE_ENV === "development" && devDetail ? (
            <p className="mt-3 break-all text-left font-mono text-xs text-hq-fg-subtle">
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

  if (state.requiresMemberLink) {
    redirect({ href: `/onboard?next=${encodeURIComponent("/dashboard")}`, locale });
  }

  // Owner/maintainer (hq:video:read) short-circuits; slot processors need a check.
  const showVideoQueue =
    state.permissions.includes("hq:video:read") ||
    (await sessionCanReadAllianceVideoQueue(state.sessionId));

  return (
    <TimezoneProvider initialTimezoneId={state.timezone}>
      <ShellActivityBoundary>
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
        isAshedConnectAllowed={state.rbac?.isAshedConnectAllowed ?? false}
        ashed={state.ashed}
        showAdminPortal={state.permissions.includes("hq:admin")}
        showTeamAccess={state.showTeamAccess}
        showVideoQueue={showVideoQueue}
        showVideoProcessorsNav={state.showVideoProcessorsNav}
        showAllianceSettings={Boolean(state.currentAllianceId)}
        currentAllianceId={
          state.currentAllianceId ?? state.allianceId ?? null
        }
        isPlatformMaintainer={state.rbac?.isPlatformMaintainer ?? false}
        membershipAlliances={state.membershipAlliances}
        sessionPermissions={state.permissions}
        devQuickSwitch={isDevOrPreviewEnvironment()}
      >
        {children}
        </AshedShell>
      </ShellActivityBoundary>
    </TimezoneProvider>
  );
}
