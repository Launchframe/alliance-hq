import { getLocale, getTranslations } from "next-intl/server";

import { listCredentialShareActivity } from "@/lib/ashed/credential-share-audit.server";
import { listCredentialSharesForHqUser } from "@/lib/ashed/credential-share.server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getRbacContext } from "@/lib/rbac/context";
import {
  requirePageSession,
  resolveEffectiveHqUserIdForSession,
} from "@/lib/session";
import { userCanViewFullCredentialShareHistory } from "@/lib/ashed/credential-share-audit.server";

export const dynamic = "force-dynamic";

export default async function CredentialShareHistoryPage() {
  const locale = await getLocale();
  const t = await getTranslations("credentialShare.history");
  const session = await requirePageSession("/account/credential-shares");
  const hqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );
  if (!hqUserId) {
    return null;
  }

  const rbac = await getRbacContext(session.id);
  const db = getDb();
  const [user] = await db
    .select({ ashedUserId: schema.hqUsers.ashedUserId })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .limit(1);

  const shares = await listCredentialSharesForHqUser(hqUserId);
  const canViewFull = await userCanViewFullCredentialShareHistory({
    hqUserId,
    isPlatformMaintainer: rbac?.isPlatformMaintainer ?? false,
    hasAshedUserId: Boolean(user?.ashedUserId?.trim()),
  });

  const activity = canViewFull
    ? (
        await listCredentialShareActivity({
          hqUserId,
          limit: 50,
        })
      ).items
    : [];

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>

      {shares.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
      ) : (
        <div className="space-y-3">
          {shares.map((share) => {
            const role =
              share.ownerHqUserId === hqUserId
                ? t("roleGranted")
                : t("roleReceived");
            return (
              <div
                key={share.id}
                className="rounded-lg border border-hq-border bg-hq-surface px-4 py-3 text-sm"
              >
                <div className="font-medium text-hq-fg">{role}</div>
                <div className="text-hq-fg-muted">{share.status}</div>
                {share.endReason ? (
                  <div className="text-hq-fg-muted">
                    {t(`endReason.${share.endReason}`)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {canViewFull && activity.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{t("title")}</h2>
          <ul className="mt-3 space-y-2 text-sm text-hq-fg-muted">
            {activity.map((entry) => (
              <li key={entry.id}>
                {entry.action} · {new Date(entry.createdAt).toLocaleString(locale)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
