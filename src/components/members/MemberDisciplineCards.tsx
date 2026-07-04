"use client";

import { useTranslations } from "next-intl";

type CommendationRow = {
  id: string;
  commendationType: string | null;
  notes: string | null;
  recordedDate: string | null;
};

type ViolationRow = {
  id: string;
  violationType: string | null;
  notes: string | null;
  recordedDate: string | null;
  expungedAt: string | null;
};

export function MemberCommendationCards({ rows }: { rows: CommendationRow[] }) {
  const t = useTranslations("members.profile");

  if (rows.length === 0) {
    return <p className="text-sm text-[#8b949e]">{t("commendationEmpty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded-lg border border-[#238636]/40 bg-[#238636]/5 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-[#238636]/60 bg-[#238636]/10 px-2.5 py-0.5 text-xs font-medium text-[#3fb950]">
              {row.commendationType?.trim() || t("disciplineNoType")}
            </span>
            {row.recordedDate ? (
              <span className="text-xs text-[#6e7681]">{row.recordedDate}</span>
            ) : null}
          </div>
          {row.notes ? (
            <p className="mt-2 break-words text-sm text-[#c9d1d9]">{row.notes}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function MemberViolationCards({ rows }: { rows: ViolationRow[] }) {
  const t = useTranslations("members.profile");

  if (rows.length === 0) {
    return <p className="text-sm text-[#8b949e]">{t("violationEmpty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const expunged = row.expungedAt != null;
        return (
          <li
            key={row.id}
            className={
              expunged
                ? "rounded-lg border border-[#30363d] bg-[#0d1117]/60 p-3 opacity-80"
                : "rounded-lg border border-[#f85149]/40 bg-[#f85149]/5 p-3"
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  expunged
                    ? "inline-flex rounded-full border border-[#484f58] bg-[#21262d] px-2.5 py-0.5 text-xs font-medium text-[#8b949e]"
                    : "inline-flex rounded-full border border-[#f85149]/60 bg-[#f85149]/10 px-2.5 py-0.5 text-xs font-medium text-[#f85149]"
                }
              >
                {row.violationType?.trim() || t("disciplineNoType")}
              </span>
              {expunged ? (
                <span className="text-xs font-medium uppercase tracking-wide text-[#8b949e]">
                  {t("violationExpunged")}
                </span>
              ) : null}
              {row.recordedDate ? (
                <span className="text-xs text-[#6e7681]">{row.recordedDate}</span>
              ) : null}
            </div>
            {row.notes ? (
              <p className="mt-2 break-words text-sm text-[#c9d1d9]">{row.notes}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
