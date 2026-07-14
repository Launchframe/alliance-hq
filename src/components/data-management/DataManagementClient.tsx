"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Database, Trash2 } from "lucide-react";

import { FormattedDateTime } from "@/components/timezone/TimezoneProvider";
import { Dialog } from "@/components/ui/dialog";
import type { DataBatchRow } from "@/lib/data-management/batch-authorization.shared";

type ScoreTargetOption = {
  id: string;
  labelKey: string;
  submitEntity: string;
};

type BatchRow = DataBatchRow & { canMove: boolean; canDelete: boolean };

type BatchScoreRow = {
  id: string | null;
  memberId: string | null;
  memberName: string | null;
  score: number | string | null;
  rank: number | null;
  team: string | null;
};

type Props = {
  initialBatches: BatchRow[];
  scoreTargets: ScoreTargetOption[];
  initialScoreTarget: string;
};

export function DataManagementClient({
  initialBatches,
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
  const [batches, setBatches] = useState(initialBatches);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (queryDate) {
      const match = initialBatches.find(
        (batch) => batch.recordedDate === queryDate,
      );
      if (match) return match.id;
    }
    return initialBatches[0]?.id ?? null;
  });
  const [moveDate, setMoveDate] = useState("");
  const [acting, setActing] = useState<"move" | "delete" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BatchRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scores, setScores] = useState<BatchScoreRow[]>([]);
  const [scoresLoading, setScoresLoading] = useState(false);
  const [scoresError, setScoresError] = useState<string | null>(null);

  const selected = useMemo(
    () => batches.find((batch) => batch.id === selectedId) ?? null,
    [batches, selectedId],
  );

  const displayedScores = selectedId ? scores : [];

  const refreshBatches = useCallback(
    async (nextScoreTarget: string, preferDate?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/data-management/batches?scoreTarget=${encodeURIComponent(nextScoreTarget)}`,
        );
        const data = (await res.json()) as {
          batches?: BatchRow[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error ?? t("loadFailed"));
        }
        const nextBatches = data.batches ?? [];
        setBatches(nextBatches);
        setSelectedId((current) => {
          if (preferDate) {
            const byDate = nextBatches.find(
              (batch) => batch.recordedDate === preferDate,
            );
            if (byDate) return byDate.id;
          }
          return nextBatches.some((batch) => batch.id === current)
            ? current
            : (nextBatches[0]?.id ?? null);
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
    if (!selectedId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        setScoresLoading(true);
        setScoresError(null);
        setScores([]);
        try {
          const res = await fetch(
            `/api/data-management/batches/${selectedId}/scores`,
            { signal: controller.signal },
          );
          const data = (await res.json()) as {
            scores?: BatchScoreRow[];
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
  }, [selectedId, t]);

  async function handleTargetChange(nextTarget: string) {
    setScoreTarget(nextTarget);
    await refreshBatches(nextTarget);
  }

  async function handleDelete(batch: BatchRow) {
    setActing("delete");
    setDeleteError(null);
    setError(null);
    try {
      const res = await fetch(`/api/data-management/batches/${batch.id}/delete`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("deleteFailed"));
      }
      setPendingDelete(null);
      setDeleteError(null);
      await refreshBatches(scoreTarget);
      setSelectedId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : t("deleteFailed");
      setDeleteError(message);
      setError(message);
    } finally {
      setActing(null);
    }
  }

  async function handleMove(batch: BatchRow) {
    if (!moveDate) {
      setError(t("moveDateRequired"));
      return;
    }
    setActing("move");
    setError(null);
    try {
      const res = await fetch(`/api/data-management/batches/${batch.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newRecordedDate: moveDate }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("moveFailed"));
      }
      setMoveDate("");
      await refreshBatches(scoreTarget);
      setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("moveFailed"));
    } finally {
      setActing(null);
    }
  }

  function teamLabel(team: string | undefined): string | null {
    if (team === "A") return tReview("teamA");
    if (team === "B") return tReview("teamB");
    return null;
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
            ) : batches.length === 0 ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">{t("empty")}</p>
            ) : (
              batches.map((batch) => {
                const active = batch.id === selectedId;
                const team = teamLabel(batch.contextJson.team);
                return (
                  <button
                    key={batch.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(batch.id);
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
                        <p className="font-medium">{batch.recordedDate}</p>
                        {team ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {team}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("uploadedAt")}:{" "}
                          <FormattedDateTime
                            value={batch.submittedAt}
                            dateStyle="medium"
                          />
                        </p>
                      </div>
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {t("recordCount", { count: batch.rowCount })}
                      </span>
                    </div>
                    <p className="mt-3 text-lg font-semibold">
                      {t("totalRows", { count: batch.rowCount })}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {batch.canMove ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                          <ArrowRight className="h-3.5 w-3.5" />
                          {t("move")}
                        </span>
                      ) : null}
                      {batch.canDelete ? (
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
                {teamLabel(selected.contextJson.team) ? (
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {teamLabel(selected.contextJson.team)}
                  </span>
                ) : null}
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("scoreTarget")}</dt>
                  <dd>
                    {tNav(
                      scoreTargets.find((t) => t.id === selected.scoreTarget)
                        ?.labelKey ?? "desertStorm",
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("entity")}</dt>
                  <dd>{selected.submitEntity}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("recordCountLabel")}</dt>
                  <dd>{selected.rowCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("submittedAt")}</dt>
                  <dd>
                    <FormattedDateTime
                      value={selected.submittedAt}
                      dateStyle="medium"
                      timeStyle="short"
                    />
                  </dd>
                </div>
              </dl>

              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium">{t("scoresHeading")}</h3>
                {scoresLoading ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("scoresLoading")}
                  </p>
                ) : scoresError ? (
                  <p className="mt-2 text-sm text-destructive">{scoresError}</p>
                ) : displayedScores.length === 0 ? (
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
                            {t("scoresScore")}
                          </th>
                          <th className="px-3 py-2 font-medium">
                            {t("scoresRank")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedScores.map((row, index) => (
                          <tr
                            key={row.id ?? `${row.memberId}-${index}`}
                            className="border-t border-border"
                          >
                            <td className="px-3 py-2">
                              {row.memberName ?? "—"}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {row.score ?? "—"}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {row.rank ?? "—"}
                            </td>
                          </tr>
                        ))}
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
                        onClick={() => void handleMove(selected)}
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
                        setPendingDelete(selected);
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
                  {t("readOnlyBatch")}
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
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && acting === "delete") return;
          if (!open) {
            setPendingDelete(null);
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
                setPendingDelete(null);
                setDeleteError(null);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-60"
            >
              {t("deleteCancel")}
            </button>
            <button
              type="button"
              disabled={acting === "delete" || !pendingDelete}
              onClick={() => {
                if (pendingDelete) void handleDelete(pendingDelete);
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
