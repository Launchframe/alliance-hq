"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";

type Props = {
  ashed: AshedConnectionMeta;
};

export function TokenExpiryBanner({ ashed }: Props) {
  const t = useTranslations("tokenExpiry");

  if (!ashed.showExpiryReminder || !ashed.tokenExpiresAtFormatted) {
    return null;
  }

  return (
    <div
      className={`border-b px-6 py-3 text-sm ${
        ashed.isTokenExpired
          ? "border-[#f85149]/40 bg-[#f8514915] text-[#f85149]"
          : "border-[#d29922]/40 bg-[#d2992215] text-[#e6edf3]"
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
            <Link href="/connect" className="text-[#58a6ff] hover:underline">
              {t("reconnectLink")}
            </Link>
            .
          </>
        ) : (
          <>
            {t("reminderBanner", { date: ashed.tokenExpiresAtFormatted })}{" "}
            <Link href="/connect" className="text-[#58a6ff] hover:underline">
              {t("updateLink")}
            </Link>
            .
          </>
        )}
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
      className={`rounded-lg border border-[#30363d] bg-[#0d1117] px-4 py-3 text-sm ${className ?? ""}`}
    >
      <p>
        {t.rich("connectedNotice", {
          date: () => (
            <strong className="text-[#e6edf3]">{formattedDate}</strong>
          ),
          days: () => (
            <strong className="text-[#e6edf3]">
              {t("reminderDaysCount", { days: reminderDays })}
            </strong>
          ),
        })}
      </p>
      <p className="mt-2 text-[#8b949e]">
        <strong className="text-[#d29922]">{tc("note")}:</strong>{" "}
        {t("logoutWarning")}
      </p>
    </div>
  );
}
