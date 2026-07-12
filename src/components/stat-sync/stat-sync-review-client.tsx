"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { MonotonicStatId, StatSyncReviewRow } from "@/lib/hq-ashed-stat-sync/types";

type Props = {
  initialStat: MonotonicStatId;
  initialRows: StatSyncReviewRow[];
};

export function StatSyncReviewClient({ initialStat, initialRows }: Props) {
  const t = useTranslations("statSync");
  const [stat, setStat] = useState<MonotonicStatId>(initialStat);
  const [rows, setRows] = useState<StatSyncReviewRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(
    async (nextStat: MonotonicStatId) => {
      setError(null);
      const res = await fetch(`/api/stat-sync?stat=${nextStat}`);
      const body = (await res.json()) as {
        rows?: StatSyncReviewRow[];
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? t("loadFailed"));
        return;
      }
      setRows(body.rows ?? []);
    },
    [t],
  );

  const selectStat = (next: MonotonicStatId) => {
    setStat(next);
    startTransition(() => {
      void load(next);
    });
  };

  const act = (action: "keep_hq" | "keep_ashed" | "discard", row: StatSyncReviewRow) => {
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/stat-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          stat: row.stat,
          commanderId: row.commanderId,
          ashedMemberId: row.ashedMemberId,
          memberName: row.memberName,
          total: row.hqTotal,
          ashedTotal: row.ashedTotal,
          eventId: row.eventId,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("actionFailed"));
        return;
      }
      await load(stat);
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        <div className="flex gap-2">
          {(["thp", "kills"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={
                stat === id
                  ? "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
                  : "rounded-md border px-3 py-1.5 text-sm"
              }
              onClick={() => selectStat(id)}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <li
              key={`${row.commanderId}-${row.eventId}`}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-sm">
                <div className="font-medium">{row.memberName}</div>
                <div className="text-muted-foreground">
                  {t("hqTotal", {
                    total: Math.round(row.hqTotal).toLocaleString(),
                  })}
                  {row.hqSource ? ` · ${row.hqSource}` : ""}
                  {row.reason === "pending_outbound"
                    ? ` · ${t("pendingOutbound")}`
                    : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending}
                  className="rounded-md border px-2 py-1 text-sm"
                  onClick={() => act("keep_hq", row)}
                >
                  {t("keepHq")}
                </button>
                <button
                  type="button"
                  disabled={pending || row.ashedTotal == null}
                  className="rounded-md border px-2 py-1 text-sm"
                  onClick={() => act("keep_ashed", row)}
                >
                  {t("keepAshed")}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="rounded-md border px-2 py-1 text-sm"
                  onClick={() => act("discard", row)}
                >
                  {t("discard")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
