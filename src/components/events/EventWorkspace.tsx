"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { AshedImportPanel } from "@/components/events/AshedImportPanel";
import { EventReadinessPanel } from "@/components/events/EventReadinessPanel";
import { ManualEvidenceDialog } from "@/components/events/ManualEvidenceDialog";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { EventTarget } from "@/lib/hq-events/event-types.shared";
import {
  batchSourceKindLabelKey,
  batchStatusLabelKey,
  boardTeamScope,
  formatEventScore,
  participationCreditFor,
  resultFilterOf,
  scoreMinimumFor,
  type EventBoardDto,
  type EventEvidenceBatchDto,
  type EventEvidencePageDto,
  type EventObservationDto,
  type EventResultFilter,
  type EventResultRow,
} from "@/lib/hq-events/workspace.shared";
import type { AshedMember } from "@/lib/video/member-matcher";

type EventDetail = {
  id: string;
  seriesId: string | null;
  name: string;
  scoreTarget: string;
  eventFamily: string | null;
  policyVersion: number | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  ashedEventId: string | null;
};

type Props = {
  eventId: string;
  canWriteScores: boolean;
  canWriteEvents: boolean;
  canWriteTrains: boolean;
};

const FILTERS: EventResultFilter[] = [
  "scored",
  "yes_only",
  "no_only",
  "conflict",
  "no_evidence",
];

const FILTER_LABEL_KEY: Record<EventResultFilter, string> = {
  scored: "realScore",
  yes_only: "pollYes",
  no_only: "pollNo",
  conflict: "conflictingEvidence",
  no_evidence: "noEvidence",
};

function badgeClass(kind: EventResultRow["evidenceClass"]): string {
  switch (kind) {
    case "real":
      return "bg-hq-accent/10 text-hq-accent";
    case "yes_only":
      return "bg-hq-warning/10 text-hq-warning";
    case "explicit_no":
      return "bg-hq-surface-muted text-hq-fg-muted";
    case "legacy_leaderboard":
      return "bg-hq-warning/10 text-hq-warning";
    case "conflict":
      return "bg-hq-danger/10 text-hq-danger";
    default:
      return "bg-hq-surface-muted text-hq-fg-muted";
  }
}

function evidenceBadgeKey(row: EventResultRow): string {
  if (row.conflictKind || row.evidenceClass === "conflict")
    return "conflictingEvidence";
  switch (row.evidenceClass) {
    case "real":
      return "leaderboardEvidence";
    case "yes_only":
      return "pollYes";
    case "explicit_no":
      return "pollNo";
    case "legacy_leaderboard":
      return "legacyLeaderboard";
    default:
      return "noEvidence";
  }
}

export function EventWorkspace({
  eventId,
  canWriteScores,
  canWriteEvents,
  canWriteTrains,
}: Props) {
  const t = useTranslations("eventEvidence");
  const tVideo = useTranslations("videoReview");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("vsPerformance.actions");
  const tVsErrors = useTranslations("vsPerformance.errors");
  const locale = useLocale();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [evidence, setEvidence] = useState<EventEvidencePageDto | null>(null);
  const [boardId, setBoardId] = useState<string>("");
  const [filter, setFilter] = useState<EventResultFilter | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [roster, setRoster] = useState<AshedMember[] | null>(null);
  const [excluding, setExcluding] = useState<EventObservationDto | null>(null);
  const [excludePending, setExcludePending] = useState(false);

  const target = (event?.eventFamily ??
    event?.scoreTarget ??
    null) as EventTarget | null;

  const reload = useCallback(() => {
    Promise.all([
      fetch(`/api/hq-events/${eventId}`, { cache: "no-store" }).then(
        async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error(body?.error ?? "load_failed");
          return body;
        },
      ),
      fetch(`/api/hq-events/${eventId}/evidence?limit=100`, {
        cache: "no-store",
      }).then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "load_failed");
        return body as EventEvidencePageDto;
      }),
    ])
      .then(([detail, page]) => {
        setError(null);
        setEvent(detail.event);
        setEvidence(page);
        setBoardId((current) =>
          page.boards.some((b: EventBoardDto) => b.id === current)
            ? current
            : (page.boards[0]?.id ?? ""),
        );
      })
      .catch((e) =>
        setError(
          e?.message === "Forbidden"
            ? tVsErrors("forbidden")
            : t("actionFailed"),
        ),
      );
  }, [eventId, t]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Roster needed for the no-evidence bucket and manual entry matching.
  useEffect(() => {
    if (roster != null) return;
    let cancelled = false;
    fetch("/api/members", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error("load_failed");
        return body;
      })
      .then((body) => {
        if (!cancelled) setRoster(body?.members ?? []);
      })
      .catch(() => {
        if (!cancelled) setRoster([]);
      });
    return () => {
      cancelled = true;
    };
  }, [roster]);

  const board: EventBoardDto | null = useMemo(
    () =>
      evidence?.boards.find((b) => b.id === boardId) ??
      evidence?.boards[0] ??
      null,
    [evidence, boardId],
  );

  const boardResults = useMemo(
    () =>
      (evidence?.results ?? []).filter((row) => row.boardId === board?.id),
    [evidence, board],
  );

  const activeRoster = useMemo(
    () => (roster ?? []).filter((m) => m.status !== "former"),
    [roster],
  );

  const noEvidenceMembers = useMemo(() => {
    const evidenced = new Set(boardResults.map((row) => row.memberId));
    return activeRoster.filter((m) => !evidenced.has(m.id));
  }, [boardResults, activeRoster]);

  const counts = useMemo(() => {
    const c: Record<EventResultFilter, number> = {
      scored: 0,
      yes_only: 0,
      no_only: 0,
      conflict: 0,
      no_evidence: noEvidenceMembers.length,
    };
    for (const row of boardResults) {
      const bucket = resultFilterOf(row);
      if (bucket) c[bucket] += 1;
    }
    return c;
  }, [boardResults, noEvidenceMembers]);

  const visibleResults = useMemo(
    () =>
      filter === "all"
        ? boardResults
        : boardResults.filter((row) => resultFilterOf(row) === filter),
    [boardResults, filter],
  );

  const observationsById = useMemo(() => {
    const map = new Map<string, EventObservationDto>();
    for (const obs of evidence?.observations ?? []) map.set(obs.id, obs);
    return map;
  }, [evidence]);

  const conflictRows = useMemo(
    () =>
      boardResults.filter((row) => resultFilterOf(row) === "conflict"),
    [boardResults],
  );
  const stagedBatches = useMemo(
    () =>
      (evidence?.batches ?? []).filter(
        (batch) =>
          batch.sourceKind === "ashed_import" &&
          batch.legacyMappingConfirmed === 0,
      ),
    [evidence],
  );

  const excludeObservation = async (obs: EventObservationDto) => {
    setExcludePending(true);
    setError(null);
    try {
      const res = await fetch(`/api/hq-events/${eventId}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          boards: [
            { boardId: obs.boardId, retractsObservationIds: [obs.id] },
          ],
        }),
      });
      if (!res.ok) {
        setError(
          res.status === 403
            ? tVsErrors("forbidden")
            : t("actionFailed"),
        );
        return;
      }
      setExcluding(null);
      reload();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setExcludePending(false);
    }
  };

  const boardLabel = (b: EventBoardDto) => {
    const scope = boardTeamScope(b.boardKey);
    return scope === "A"
      ? tVideo("teamA")
      : scope === "B"
        ? tVideo("teamB")
        : b.name ?? b.boardKey;
  };

  if (error && !evidence) {
    return (
      <p role="alert" className="text-sm text-hq-danger">
        {error}
      </p>
    );
  }
  if (!event || !evidence) {
    return <p className="text-sm text-hq-fg-muted">{tCommon("loading")}</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-hq-fg">
            {event.name}
          </h1>
          <p className="text-xs text-hq-fg-muted">
            {[event.startDate, event.endDate, event.scoreTarget]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canWriteScores ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setManualOpen(true)}
              >
                {t("manualEntry")}
              </Button>
              <Link
                href={`/tools/video-upload?eventId=${eventId}`}
                className="inline-flex items-center justify-center rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-sm font-medium text-hq-fg transition hover:bg-hq-surface"
              >
                {t("uploadEvidence")}
              </Link>
            </>
          ) : null}
          {canWriteTrains ? (
            <Link
              href={`/trains?eventId=${eventId}`}
              className="inline-flex items-center justify-center rounded-lg bg-hq-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              {t("useForTrain")}
            </Link>
          ) : null}
        </div>
      </header>

      {evidence.boards.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {evidence.boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBoardId(b.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                b.id === board?.id
                  ? "border-hq-accent bg-hq-accent/10 text-hq-accent"
                  : "border-hq-border text-hq-fg-muted hover:text-hq-fg"
              }`}
            >
              {boardLabel(b)}
            </button>
          ))}
        </div>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-full px-2.5 py-1 text-xs ${filter === "all" ? "bg-hq-accent/10 text-hq-accent" : "text-hq-fg-muted hover:text-hq-fg"}`}
          >
            {boardResults.length + noEvidenceMembers.length}
          </button>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs ${filter === f ? "bg-hq-accent/10 text-hq-accent" : "text-hq-fg-muted hover:text-hq-fg"}`}
            >
              {t(FILTER_LABEL_KEY[f])} · {counts[f]}
            </button>
          ))}
        </div>
        <p className="text-xs text-hq-fg-muted">
          {t("scoreMinimum", {
            minimum: formatEventScore(scoreMinimumFor(target), locale) ?? "0",
          })}
        </p>
        {filter === "no_evidence" ? (
          <p className="text-xs text-hq-fg-muted">{t("noEvidenceHint")}</p>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-hq-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-hq-border bg-hq-surface text-xs text-hq-fg-muted">
              <tr>
                <th className="px-3 py-2 font-medium">{tVideo("colName")}</th>
                <th className="px-3 py-2 font-medium">{t("realScore")}</th>
                <th className="px-3 py-2 font-medium">
                  {t("participationCredit")}
                </th>
                <th className="px-3 py-2 font-medium">{t("observedRank")}</th>
                <th className="px-3 py-2 font-medium">{t("evidenceSource")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hq-border bg-hq-canvas">
              {visibleResults.map((row) => {
                const credit = participationCreditFor(row);
                const legacyMissing =
                  row.evidenceClass === "legacy_leaderboard" &&
                  row.realScore == null;
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2 text-hq-fg">
                      {row.memberName ?? row.memberId}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-hq-fg">
                      {formatEventScore(row.realScore, locale) ?? (
                        <span
                          className="text-hq-fg-muted"
                          title={
                            legacyMissing ? t("actualScoreMissingHint") : ""
                          }
                        >
                          {legacyMissing ? t("actualScoreMissing") : "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-hq-fg">
                      {credit ? formatEventScore(credit, locale) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-hq-fg">
                      {row.observedRank ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(row.evidenceClass)}`}
                      >
                        {t(evidenceBadgeKey(row))}
                      </span>
                      {row.evidenceClass === "real" && row.participation ? (
                        <span
                          className="ml-1 text-xs text-hq-fg-muted"
                          title={t("keepRealScore")}
                        >
                          {row.participation === "yes"
                            ? t("pollYes")
                            : t("pollNo")}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {filter === "all" || filter === "no_evidence"
                ? noEvidenceMembers.map((member) => (
                    <tr key={`none-${member.id}`}>
                      <td className="px-3 py-2 text-hq-fg">
                        {member.current_name}
                      </td>
                      <td className="px-3 py-2 text-hq-fg-muted">—</td>
                      <td className="px-3 py-2 text-hq-fg-muted">—</td>
                      <td className="px-3 py-2 text-hq-fg-muted">—</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex rounded-full bg-hq-surface-muted px-2 py-0.5 text-xs font-medium text-hq-fg-muted">
                          {t("noEvidence")}
                        </span>
                      </td>
                    </tr>
                  ))
                : null}
              {visibleResults.length === 0 &&
              (filter !== "all" && filter !== "no_evidence"
                ? true
                : noEvidenceMembers.length === 0) ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-xs text-hq-fg-muted"
                  >
                    {t("noEvidence")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-hq-fg-muted">
          {t("rosterSnapshot")} · {activeRoster.length}
        </p>
      </section>

      {conflictRows.length > 0 || stagedBatches.length > 0 ? (
        <section className="space-y-2 rounded-lg border border-hq-border bg-hq-surface p-4">
          <h3 className="text-sm font-semibold text-hq-fg">
            {t("reviewQueue")}
          </h3>
          <ul className="space-y-2">
            {conflictRows.map((row) => (
              <li key={row.id} className="space-y-1">
                <p className="text-sm text-hq-fg">
                  {row.memberName ?? row.memberId}
                  <span className="ml-2 text-xs text-hq-danger">
                    {t("conflictingEvidence")}
                  </span>
                </p>
                <ul className="space-y-1 pl-3">
                  {(row.contributingObservationIds ?? [])
                    .map((id) => observationsById.get(id))
                    .filter((obs): obs is EventObservationDto =>
                      Boolean(obs && !obs.retracted),
                    )
                    .map((obs) => (
                      <li
                        key={obs.id}
                        className="flex items-center justify-between gap-2 text-xs text-hq-fg-muted"
                      >
                        <span>
                          {obs.memberName ?? obs.memberId} ·{" "}
                          {t(
                            KIND_BADGE[obs.evidenceKind] ??
                              "leaderboardEvidence",
                          )}
                          {obs.realScore != null
                            ? ` · ${formatEventScore(obs.realScore, locale)}`
                            : ""}
                          {obs.pollOption != null
                            ? ` · ${t("detectedPollOption", { option: obs.pollOption })}`
                            : ""}
                        </span>
                        {canWriteScores ? (
                          <button
                            type="button"
                            className="text-hq-danger hover:underline"
                            onClick={() => setExcluding(obs)}
                          >
                            {t("excludeRow")}
                          </button>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
            {stagedBatches.map((batch) => (
              <li key={batch.id} className="text-xs text-hq-fg-muted">
                {t(batchSourceKindLabelKey(batch.sourceKind))} ·{" "}
                {t("pendingEvidence")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-2 rounded-lg border border-hq-border bg-hq-surface p-4">
        <h3 className="text-sm font-semibold text-hq-fg">{t("batches")}</h3>
        {(evidence.batches ?? []).length === 0 ? (
          <p className="text-xs text-hq-fg-muted">{t("noEvidence")}</p>
        ) : (
          <ul className="divide-y divide-hq-border text-xs text-hq-fg-muted">
            {evidence.batches.map((batch: EventEvidenceBatchDto) => (
              <li
                key={batch.id}
                className="flex flex-wrap items-center gap-2 py-1.5"
              >
                <span className="text-hq-fg">
                  {t(batchSourceKindLabelKey(batch.sourceKind))}
                </span>
                <span>{t(batchStatusLabelKey(batch.status))}</span>
                {batch.importStatus === "incomplete" ? (
                  <span className="text-hq-warning">
                    {t("importIncomplete")}
                  </span>
                ) : null}
                <span className="ml-auto">
                  {new Date(batch.createdAt).toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWriteScores || canWriteEvents ? (
        <AshedImportPanel
          eventId={eventId}
          target={target}
          ashedEventId={event.ashedEventId}
          canLink={canWriteEvents}
          canImport={canWriteScores}
          onChanged={reload}
        />
      ) : null}

      {canWriteTrains && board ? (
        <EventReadinessPanel
          board={board}
          batches={evidence.batches ?? []}
          results={boardResults}
          canMarkReady={canWriteTrains}
          onChanged={reload}
        />
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-hq-danger">
          {error}
        </p>
      ) : null}

      <ManualEvidenceDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        eventId={eventId}
        boardId={board?.id ?? ""}
        onSaved={reload}
      />

      {excluding ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-lg border border-hq-border bg-hq-canvas p-4">
            <p className="text-sm text-hq-fg">
              {excluding.memberName ?? excluding.memberId} ·{" "}
              {t("excludeRow")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={excludePending}
                onClick={() => setExcluding(null)}
              >
                {tActions("cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={excludePending}
                onClick={() => void excludeObservation(excluding)}
              >
                {t("excludeRow")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const KIND_BADGE: Record<string, string> = {
  leaderboard: "leaderboardEvidence",
  poll_yes: "pollYes",
  poll_no: "pollNo",
  legacy_leaderboard: "legacyLeaderboard",
};
