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
    return <p className="text-sm text-hq-fg-muted">{t("commendationEmpty")}</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded-lg border border-hq-success/40 bg-hq-success/5 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full border border-hq-success/60 bg-hq-success/10 px-2.5 py-0.5 text-xs font-medium text-hq-green">
              {row.commendationType?.trim() || t("disciplineNoType")}
            </span>
            {row.recordedDate ? (
              <span className="text-xs text-hq-fg-subtle">{row.recordedDate}</span>
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
    return <p className="text-sm text-hq-fg-muted">{t("violationEmpty")}</p>;
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
                ? "rounded-lg border border-hq-border bg-hq-canvas/60 p-3 opacity-80"
                : "rounded-lg border border-hq-danger/40 bg-hq-danger/5 p-3"
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  expunged
                    ? "inline-flex rounded-full border border-[#484f58] bg-hq-surface-muted px-2.5 py-0.5 text-xs font-medium text-hq-fg-muted"
                    : "inline-flex rounded-full border border-hq-danger/60 bg-hq-danger/10 px-2.5 py-0.5 text-xs font-medium text-hq-danger"
                }
              >
                {row.violationType?.trim() || t("disciplineNoType")}
              </span>
              {expunged ? (
                <span className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                  {t("violationExpunged")}
                </span>
              ) : null}
              {row.recordedDate ? (
                <span className="text-xs text-hq-fg-subtle">{row.recordedDate}</span>
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
