"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { LinkedCommanderRow } from "@/lib/members/linked-commanders.shared";
import { Button } from "@/components/ui/button";

type Props = {
  commanders: LinkedCommanderRow[];
};

export function LinkedCommandersCard({ commanders }: Props) {
  const t = useTranslations("account.linkedCommanders");
  const [rows, setRows] = useState(commanders);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<LinkedCommanderRow | null>(null);

  async function unlink(row: LinkedCommanderRow) {
    const key = `${row.allianceId}:${row.ashedMemberId}`;
    setBusyKey(key);
    setError(null);
    try {
      const res = await fetch("/api/account/linked-commanders/unlink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allianceId: row.allianceId,
          ashedMemberId: row.ashedMemberId,
        }),
      });
      if (!res.ok) {
        setError(t("unlinkFailed"));
        return;
      }
      setRows((current) =>
        current.filter(
          (item) =>
            item.allianceId !== row.allianceId ||
            item.ashedMemberId !== row.ashedMemberId,
        ),
      );
      setPending(null);
    } catch {
      setError(t("unlinkFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section
      aria-labelledby="linked-commanders-heading"
      className="rounded-xl border border-hq-border bg-hq-surface p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="linked-commanders-heading"
            className="text-lg font-semibold text-hq-fg"
          >
            {t("title")}
          </h2>
          <p className="text-sm text-hq-fg-muted">{t("body")}</p>
        </div>
        <Link
          href="/onboard?next=%2Faccount"
          className="inline-flex h-8 items-center justify-center rounded-lg border border-hq-border bg-transparent px-3 text-xs font-medium text-hq-fg transition hover:bg-hq-surface-muted"
        >
          {t("linkAnother")}
        </Link>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-hq-fg-muted">{t("empty")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => {
            const key = `${row.allianceId}:${row.ashedMemberId}`;
            const label = row.memberDisplayName?.trim() ?? "";
            const alliance = row.allianceTag ?? row.allianceName;
            return (
              <li
                key={key}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hq-border bg-hq-canvas px-4 py-3"
              >
                <div>
                  <div className="font-medium text-hq-fg">
                    {label || alliance}
                  </div>
                  {label ? (
                    <div className="text-sm text-hq-fg-muted">{alliance}</div>
                  ) : null}
                </div>
                {pending?.ashedMemberId === row.ashedMemberId &&
                pending.allianceId === row.allianceId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-hq-fg-muted">
                      {t("unlinkConfirm")}
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busyKey === key}
                      onClick={() => void unlink(row)}
                    >
                      {busyKey === key ? t("unlinking") : t("unlink")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyKey === key}
                      onClick={() => setPending(null)}
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPending(row)}
                  >
                    {t("unlink")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
