"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import type { AllianceCredentialBanner } from "@/lib/ashed/alliance-credential-expiry.shared";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import {
  buildConnectHref,
  stashConnectReturnPath,
} from "@/lib/connect/connect-return-path.shared";

type Props = {
  ashed: AshedConnectionMeta;
};

export function TokenExpiryBanner({ ashed }: Props) {
  const t = useTranslations("tokenExpiry");
  const pathname = usePathname();
  const connectHref = buildConnectHref(pathname);

  if (!ashed.showExpiryReminder || !ashed.tokenExpiresAtFormatted) {
    return null;
  }

  return (
    <div
      className={`border-b px-6 py-3 text-sm ${
        ashed.isTokenExpired
          ? "border-hq-danger/40 bg-[#f8514915] text-hq-danger"
          : "border-[#d29922]/40 bg-[#d2992215] text-hq-fg"
      }`}
    >
      <p>
        {ashed.isTokenExpired ? (
          <>
            {t.rich("expiredBanner", {
              date: () => (
                <strong>{ashed.tokenExpiresAtFormatted}</strong>
              ),
            })}{" "}
            <Link
              href={connectHref}
              onClick={() => stashConnectReturnPath(pathname)}
              className="text-hq-accent hover:underline"
            >
              {t("reconnectLink")}
            </Link>
            .
          </>
        ) : (
          <>
            {t("reminderBanner", { date: ashed.tokenExpiresAtFormatted })}{" "}
            <Link
              href={connectHref}
              onClick={() => stashConnectReturnPath(pathname)}
              className="text-hq-accent hover:underline"
            >
              {t("updateLink")}
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}

export function AllianceTokenExpiryBanner({
  banner,
}: {
  banner: AllianceCredentialBanner;
}) {
  const t = useTranslations("tokenExpiry");
  const pathname = usePathname();
  const connectHref = buildConnectHref(pathname);
  const date = () => <strong>{banner.expiresAtFormatted}</strong>;

  return (
    <div
      role="status"
      data-testid="alliance-token-expiry-banner"
      className={`border-b px-6 py-3 text-sm ${
        banner.expired
          ? "border-hq-danger/40 bg-[#f8514915] text-hq-danger"
          : "border-[#d29922]/40 bg-[#d2992215] text-hq-fg"
      }`}
    >
      <p>
        {banner.expired
          ? t.rich("allianceExpiredBanner", { tag: banner.allianceTag, date })
          : t.rich("allianceReminderBanner", { tag: banner.allianceTag, date })}
      </p>
      <p className="mt-1">
        {t.rich("allianceNextSteps", {
          reconnect: (chunks) => (
            <Link
              href={connectHref}
              onClick={() => stashConnectReturnPath(pathname)}
              className="text-hq-accent hover:underline"
            >
              {chunks}
            </Link>
          ),
          team: (chunks) => (
            <Link href="/settings/team" className="text-hq-accent hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  );
}

export function TokenExpiryNotice({
  formattedDate,
  reminderDays,
  className,
}: {
  formattedDate: string;
  reminderDays: number;
  className?: string;
}) {
  const t = useTranslations("tokenExpiry");
  const tc = useTranslations("common");

  return (
    <div
      className={`rounded-lg border border-hq-border bg-hq-canvas px-4 py-3 text-sm ${className ?? ""}`}
    >
      <p>
        {t.rich("connectedNotice", {
          date: () => (
            <strong className="text-hq-fg">{formattedDate}</strong>
          ),
          days: () => (
            <strong className="text-hq-fg">
              {t("reminderDaysCount", { days: reminderDays })}
            </strong>
          ),
        })}
      </p>
      <p className="mt-2 text-hq-fg-muted">
        <strong className="text-[#d29922]">{tc("note")}:</strong>{" "}
        {t("logoutWarning")}
      </p>
    </div>
  );
}
