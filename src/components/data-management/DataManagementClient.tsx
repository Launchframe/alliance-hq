"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Database, Trash2 } from "lucide-react";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Dialog } from "@/components/ui/dialog";
import type { DataDateSummary } from "@/lib/data-management/batch-authorization.shared";

type ScoreTargetOption = {
  id: string;
  labelKey: string;
  submitEntity: string;
};

type DateScoreRow = {
  id: string | null;
  memberId: string | null;
  memberName: string | null;
  score: number | string | null;
  rank: number | null;
  team: string | null;
};

type Props = {
  initialDates: DataDateSummary[];
  scoreTargets: ScoreTargetOption[];
  initialScoreTarget: string;
};

export function DataManagementClient({
  initialDates,
  scoreTargets,
  initialScoreTarget,
}: Props) {
  const t = useTranslations("dataManagement");
  const tNav = useTranslations("nav");
  const tReview = useTranslations("videoReview");
  const searchParams = useSearchParams();
  const queryTarget = searchParams.get("scoreTarget")?.trim();
  const queryDate = searchParams.get("recordedDate")?.trim();

  const [scoreTarget, setScoreTarget] = useState(
    queryTarget && scoreTargets.some((target) => target.id === queryTarget)
      ? queryTarget
      : initialScoreTarget,
  );
  const [dates, setDates] = useState(initialDates);
  const [selectedDate, setSelectedDate] = useState<string | null>(() => {
    if (queryDate && initialDates.some((date) => date.recordedDate === queryDate)) {
      return queryDate;
    }
    return initialDates[0]?.recordedDate ?? null;
  });
  const [moveDate, setMoveDate] = useState("");
  const [acting, setActing] = useState<"move" | "delete" | null>(null);
  const [pendingDeleteDate, setPendingDeleteDate] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scores, setScores] = useState<DateScoreRow[]>([]);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresError, setScoresError] = useState<string | null>(null);

  const selected = useMemo(
    () => dates.find((date) => date.recordedDate === selectedDate) ?? null,
    [dates, selectedDate],
  );

  const targetDef = useMemo(
    () => scoreTargets.find((target) => target.id === scoreTarget),
    [scoreTargets, scoreTarget],
  );

  const refreshDates = useCallback(
    async (nextScoreTarget: string, preferDate?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/data-management/dates?scoreTarget=${encodeURIComponent(nextScoreTarget)}`,
        );
        const data = (await res.json()) as {
          dates?: DataDateSummary[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("loadFailed"));
        }
        const nextDates = data.dates ?? [];
        setDates(nextDates);
        setSelectedDate((current) => {
          if (preferDate && nextDates.some((date) => date.recordedDate === preferDate)) {
            return preferDate;
          }
          return nextDates.some((date) => date.recordedDate === current)
            ? current
            : (nextDates[0]?.recordedDate ?? null);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : t("loadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!selectedDate) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setScoresLoading(true);
        setScoresError(null);
        setScores([]);
        try {
          const res = await fetch(
            `/api/data-management/dates/${encodeURIComponent(selectedDate)}/scores?scoreTarget=${encodeURIComponent(scoreTarget)}`,
            { signal: controller.signal },
          );
          const data = (await res.json()) as {
            scores?: DateScoreRow[];
            error?: string;
          };
          if (!res.ok) {
            throw new Error(data.error ?? t("scoresLoadFailed"));
          }
          if (!controller.signal.aborted) {
            setScores(data.scores ?? []);
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          setScores([]);
          setScoresError(
            err instanceof Error ? err.message : t("scoresLoadFailed"),
          );
        } finally {
          if (!controller.signal.aborted) {
            setScoresLoading(false);
          }
        }
      })();
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [selectedDate, scoreTarget, t]);

  async function handleTargetChange(nextTarget: string) {
    setScoreTarget(nextTarget);
    await refreshDates(nextTarget);
  }

  async function handleDelete(recordedDate: string) {
    setActing("delete");
    setDeleteError(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/data-management/dates/${encodeURIComponent(recordedDate)}/delete?scoreTarget=${encodeURIComponent(scoreTarget)}`,
        { method: "POST" },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("deleteFailed"));
      }
      setPendingDeleteDate(null);
      setDeleteError(null);
      await refreshDates(scoreTarget);
      setSelectedDate(null);
      setScores([]);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("deleteFailed");
      setDeleteError(message);
      setError(message);
    } finally {
      setActing(null);
    }
  }

  async function handleMove(recordedDate: string) {
    if (!moveDate) {
      setError(t("moveDateRequired"));
      return;
    }
    setActing("move");
    setError(null);
    try {
      const res = await fetch(
        `/api/data-management/dates/${encodeURIComponent(recordedDate)}/move?scoreTarget=${encodeURIComponent(scoreTarget)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newRecordedDate: moveDate }),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("moveFailed"));
      }
      setMoveDate("");
      await refreshDates(scoreTarget, moveDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("moveFailed"));
    } finally {
      setActing(null);
    }
  }

  function teamLabel(team: string | null | undefined): string | null {
    if (team === "A") return tReview("teamA");
    if (team === "B") return tReview("teamB");
    return null;
  }

  function teamSummary(date: DataDateSummary): string | null {
    const parts: string[] = [];
    if (date.teamACount > 0) {
      parts.push(`${tReview("teamA")}: ${date.teamACount}`);
    }
    if (date.teamBCount > 0) {
      parts.push(`${tReview("teamB")}: ${date.teamBCount}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {scoreTargets.map((target) => (
          <button
            key={target.id}
            type="button"
            onClick={() => void handleTargetChange(target.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              scoreTarget === target.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            {tNav(target.labelKey)}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">{t("availableDates")}</h2>
          </div>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3">
            {loading ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">{t("loading")}</p>
            ) : dates.length === 0 ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              dates.map((date) => {
                const active = date.recordedDate === selectedDate;
                const teams = teamSummary(date);
                return (
                  <button
                    key={date.recordedDate}
                    type="button"
                    onClick={() => {
                      setSelectedDate(date.recordedDate);
                      setMoveDate("");
                    }}
                    className={`w-full rounded-xl border p-4 text-left transition ${
                      active
                        ? "border-primary bg-primary/10"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{date.recordedDate}</p>
                        {teams ? (
                          <p className="mt-1 text-xs text-muted-foreground">{teams}</p>
                        ) : null}
                        {date.latestSubmittedAt ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("uploadedAt")}:{" "}
                            <FormattedDateTime
                              value={date.latestSubmittedAt}
                              dateStyle="medium"
                            />
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {t("recordCount", { count: date.rowCount })}
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-semibold">
                      {t("totalRows", { count: date.rowCount })}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {date.canMove ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                          <ArrowRight className="h-3.5 w-3.5" />
                          {t("move")}
                        </span>
                      ) : null}
                      {date.canDelete ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("delete")}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-6">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">{selected.recordedDate}</h2>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("scoreTarget")}</dt>
                  <dd>{tNav(targetDef?.labelKey ?? "desertStorm")}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("entity")}</dt>
                  <dd>{targetDef?.submitEntity ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("recordCountLabel")}</dt>
                  <dd>{selected.rowCount}</dd>
                </div>
                {teamSummary(selected) ? (
                  <div>
                    <dt className="text-muted-foreground">{t("scoresTeam")}</dt>
                    <dd>{teamSummary(selected)}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium">{t("scoresHeading")}</h3>
                {scoresLoading ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("scoresLoading")}
                  </p>
                ) : scoresError ? (
                  <p className="mt-2 text-sm text-destructive">{scoresError}</p>
                ) : scores.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("scoresEmpty")}
                  </p>
                ) : (
                  <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">
                            {t("scoresMember")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("scoresTeam")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("scoresScore")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("scoresRank")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {scores.map((row, index) => {
                          const team = teamLabel(row.team);
                          return (
                            <tr
                              key={row.id ?? `${row.memberId}-${row.team}-${index}`}
                              className="border-t border-border"
                            >
                              <td className="px-3 py-2">
                                {row.memberName ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {team ? (
                                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                                    {team}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2 tabular-nums">
                                {row.score ?? "—"}
                              </td>
                              <td className="px-3 py-2 tabular-nums">
                                {row.rank ?? "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {selected.canMove || selected.canDelete ? (
                <div className="space-y-3 border-t border-border pt-4">
                  {selected.canMove ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-muted-foreground">
                          {t("moveToDate")}
                        </span>
                        <input
                          type="date"
                          value={moveDate}
                          onChange={(event) => setMoveDate(event.target.value)}
                          className="rounded-lg border border-border bg-background px-3 py-2"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={acting !== null}
                        onClick={() => void handleMove(selected.recordedDate)}
                        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                      >
                        <ArrowRight className="h-4 w-4" />
                        {acting === "move" ? t("moving") : t("move")}
                      </button>
                    </div>
                  ) : null}
                  {selected.canDelete ? (
                    <button
                      type="button"
                      disabled={acting !== null}
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDeleteDate(selected.recordedDate);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("delete")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("readOnlyDate")}
                </p>
              )}
            </div>
          ) : (
            <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
              <Database className="h-8 w-8 text-muted-foreground" />
              <h2 className="mt-3 text-lg font-medium">{t("selectDateTitle")}</h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {t("selectDateBody")}
              </p>
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={pendingDeleteDate !== null}
        onOpenChange={(open) => {
          if (!open && acting === "delete") return;
          if (!open) {
            setPendingDeleteDate(null);
            setDeleteError(null);
          }
        }}
        title={t("delete")}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("deleteConfirm")}</p>
          {deleteError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {deleteError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={acting === "delete"}
              onClick={() => {
                setPendingDeleteDate(null);
                setDeleteError(null);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              {t("deleteCancel")}
            </button>
            <button
              type="button"
              disabled={acting === "delete" || !pendingDeleteDate}
              onClick={() => {
                if (pendingDeleteDate) void handleDelete(pendingDeleteDate);
              }}
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive hover:bg-destructive/20 disabled:opacity-60"
            >
              {acting === "delete" ? t("deleting") : t("delete")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
