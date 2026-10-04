"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  EMPTY_EVENT_SOURCE_SELECTION,
  EventSourcePicker,
  type EventSourceSelection,
} from "@/components/events/EventSourcePicker";
import { AppSelect } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  EVENT_FAMILY_POLICY,
  type EventTarget,
} from "@/lib/hq-events/event-types.shared";
import {
  formatEventScore,
  scoreMinimumFor,
  type EventBoardDto,
} from "@/lib/hq-events/workspace.shared";
import type {
  EventEligibilityCandidateDto,
  EventEligibilityPreview,
} from "@/lib/trains/event-eligibility.shared";
import type { EventScoresRule } from "@/lib/trains/rules/catalog.shared";

type Role = "conductor" | "vip";

type EventDetail = {
  eventId: string;
  name: string;
  startDate: string | null;
  boards: EventBoardDto[];
};

type Props = {
  role: Role;
  /** Train date the rule would apply to (preview context). */
  date: string;
  /** Existing event rule to edit. */
  initialRule?: EventScoresRule | null;
  /** Prefill this occurrence (e.g. /trains?eventId=). */
  initialEventId?: string | null;
  disabled?: boolean;
  /**
   * `template` captures a family/series intent with policy and scope — the
   * occurrence is always null and applying a template leaves the day
   * visibly unbound until an officer chooses an event.
   */
  mode?: "day" | "template";
  /** Warzone defaults action paints both roles in one apply. */
  onApplyBoth?: (patch: {
    conductorRule: EventScoresRule;
    vipRule: EventScoresRule;
  }) => void;
  onApply: (rule: EventScoresRule) => void;
  onBack?: () => void;
};

const TOP_SCOPES = [1, 3, 5, 10, "all"] as const;

const KIND_BADGE_KEY: Record<string, string> = {
  real: "leaderboardEvidence",
  yes_only: "pollYes",
  explicit_no: "pollNo",
  legacy_leaderboard: "legacyLeaderboard",
  conflict: "conflictingEvidence",
  none: "noEvidence",
};

const EXCLUSION_LABEL_KEY: Record<string, string> = {
  unavailable: "excludedTimeOff",
  locked_conductor: "excludedLockedConductor",
};

function sourceFromRule(rule: EventScoresRule): EventSourceSelection {
  return {
    target: rule.source.target,
    seriesId: rule.source.seriesId ?? "",
    eventId: rule.source.occurrenceId ?? "",
    boardId: "",
    teamScope: rule.source.teamScope ?? "",
  };
}

/**
 * Event-results rule builder for the day mechanism picker: shared source
 * picker, role-specific eligibility policy, and a live eligibility preview.
 * Emits only complete, schema-valid `event_scores` rules.
 */
export function EventRulePicker({
  role,
  date,
  initialRule = null,
  initialEventId = null,
  disabled = false,
  mode = "day",
  onApplyBoth,
  onApply,
  onBack,
}: Props) {
  const t = useTranslations("eventEvidence");
  const tTrains = useTranslations("trains");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("vsPerformance.actions");
  const locale = useLocale();

  const [selection, setSelection] = useState<EventSourceSelection>(() =>
    initialRule ? sourceFromRule(initialRule) : EMPTY_EVENT_SOURCE_SELECTION,
  );
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [policy, setPolicy] = useState<"scored" | "participants">(
    initialRule?.eligibility ?? (role === "vip" ? "participants" : "scored"),
  );
  const [topN, setTopN] = useState<EventScoresRule["topN"]>(
    initialRule?.topN ?? (role === "vip" ? "all" : 10),
  );
  const [allowFallback, setAllowFallback] = useState(
    initialRule?.fallback === "confirmed_poll_yes",
  );
  const [preview, setPreview] = useState<EventEligibilityPreview | null>(null);
  const [previewState, setPreviewState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const prefilledRef = useRef(false);

  // Prefill the occurrence chain from ?eventId= or an existing rule's board.
  useEffect(() => {
    const eventId = selection.eventId || initialEventId;
    if (!eventId) return;
    let cancelled = false;
    fetch(`/api/hq-events/${eventId}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error("load_failed");
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        const boards = (body?.boards ?? []) as EventBoardDto[];
        setDetail({
          eventId,
          name: body?.event?.name ?? "",
          startDate: body?.event?.startDate ?? null,
          boards,
        });
        if (!prefilledRef.current) {
          prefilledRef.current = true;
          setSelection((current) => {
            if (current.eventId && current.eventId !== eventId)
              return current;
            const next: EventSourceSelection = {
              target: (body?.event?.eventFamily ??
                current.target ??
                "") as EventSourceSelection["target"],
              seriesId:
                current.seriesId || (body?.event?.seriesId ?? ""),
              eventId,
              boardId: current.boardId,
              teamScope: current.teamScope,
            };
            // Resolve a saved boardKey back to the picker's board id.
            if (initialRule?.source.boardKey) {
              const match = boards.find(
                (board) => board.boardKey === initialRule.source.boardKey,
              );
              if (match) next.boardId = match.id;
            }
            return next;
          });
        }
      })
      .catch(() => {
        if (!cancelled) setDetail({ eventId, name: "", startDate: null, boards: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.eventId, initialEventId]);

  const teamScoped = selection.target
    ? EVENT_FAMILY_POLICY[selection.target].teamScoped
    : false;
  const isWarzone = selection.target === "warzone-duel";

  const templateMode = mode === "template";

  const rule = useMemo((): EventScoresRule | null => {
    if (!selection.target) return null;
    if (!templateMode && !selection.eventId) return null;
    if (teamScoped && !selection.teamScope) return null;
    const boards = detail?.eventId === selection.eventId ? detail.boards : [];
    if (
      !templateMode &&
      !teamScoped &&
      boards.length > 1 &&
      !selection.boardId
    )
      return null;
    const boardKey =
      teamScoped || templateMode
        ? null
        : (boards.find((board) => board.id === selection.boardId)?.boardKey ??
          null);
    const participants =
      isWarzone && role === "vip" && policy === "participants";
    return {
      kind: "event_scores",
      source: {
        target: selection.target as EventTarget,
        seriesId: selection.seriesId || null,
        occurrenceId: templateMode ? null : selection.eventId,
        boardKey,
        teamScope: teamScoped
          ? (selection.teamScope as "A" | "B" | "both")
          : null,
      },
      eligibility: participants ? "participants" : "scored",
      topN: participants ? "all" : topN,
      fallback:
        isWarzone &&
        role === "conductor" &&
        !participants &&
        allowFallback
          ? "confirmed_poll_yes"
          : "none",
    };
  }, [
    selection,
    teamScoped,
    isWarzone,
    role,
    policy,
    topN,
    allowFallback,
    detail,
    templateMode,
  ]);

  // Live preview of the proposed rule (no mutation server-side).
  const ruleJson = rule ? JSON.stringify(rule) : null;
  useEffect(() => {
    if (!ruleJson || templateMode) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      setPreviewState("loading");
      fetch("/api/trains/event-eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, role, rule: JSON.parse(ruleJson) }),
        cache: "no-store",
      })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error("preview_failed");
          return body;
        })
        .then((body) => {
          if (cancelled) return;
          setPreview(body?.preview ?? null);
          setPreviewState("idle");
        })
        .catch(() => {
          if (!cancelled) {
            setPreview(null);
            setPreviewState("error");
          }
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [ruleJson, date, role, templateMode]);

  const eligibility = rule ? (preview?.eligibility ?? null) : null;
  const showPreviewStatus = rule != null;
  const eventHref = selection.eventId ? `/events/${selection.eventId}` : "/events";

  const warzoneDefaults = useMemo(() => {
    if (!onApplyBoth || !rule || rule.source.target !== "warzone-duel") {
      return null;
    }
    const source = rule.source;
    return {
      conductorRule: {
        kind: "event_scores",
        source,
        eligibility: "scored",
        topN: 10,
        fallback: "none",
      } satisfies EventScoresRule,
      vipRule: {
        kind: "event_scores",
        source,
        eligibility: "participants",
        topN: "all",
        fallback: "none",
      } satisfies EventScoresRule,
    };
  }, [onApplyBoth, rule]);

  const scopeOptions = TOP_SCOPES.map((scope) => ({
    value: String(scope),
    label:
      scope === "all"
        ? t("allScored")
        : tTrains("topNScope.scopeLabel", { count: scope }),
  }));

  const candidateBadge = (candidate: EventEligibilityCandidateDto) =>
    KIND_BADGE_KEY[candidate.evidenceKind] ?? "noEvidence";

  return (
    <div className="space-y-4" data-testid="trains-event-rule-picker">
      <EventSourcePicker
        value={selection}
        onChange={setSelection}
        disabled={disabled}
        templateMode={templateMode}
      />

      {selection.eventId || (templateMode && selection.target) ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
              {t("sourcePolicy")}
            </p>
            {isWarzone && role === "vip" ? (
              <div
                className="grid grid-cols-2 gap-1 rounded-lg border border-hq-border bg-hq-canvas p-1"
                role="radiogroup"
                aria-label={t("sourcePolicy")}
              >
                {(["participants", "scored"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={policy === option}
                    disabled={disabled}
                    onClick={() => setPolicy(option)}
                    className={`rounded-md px-2 py-2 text-center text-xs font-medium disabled:opacity-50 ${
                      policy === option
                        ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-100"
                        : "text-hq-fg-muted hover:text-hq-fg"
                    }`}
                  >
                    {option === "participants"
                      ? t("allParticipants")
                      : t("leaderboardOnly")}
                  </button>
                ))}
              </div>
            ) : null}
            {isWarzone && role === "vip" && policy === "participants" ? (
              <p className="text-xs text-hq-fg-muted">
                {t("allParticipantsHint")}
              </p>
            ) : null}
            {policy === "scored" || role === "conductor" || !isWarzone ? (
              <>
                <AppSelect
                  value={String(topN)}
                  onChange={(value) =>
                    setTopN(
                      (value === "all" ? "all" : Number(value)) as
                        EventScoresRule["topN"],
                    )
                  }
                  options={scopeOptions}
                  disabled={disabled}
                  aria-label={t("sourcePolicy")}
                />
                {topN !== "all" ? (
                  <p className="text-xs text-hq-fg-muted">
                    {t("realScoreScopeHint", { count: topN })}
                  </p>
                ) : null}
              </>
            ) : null}
            {isWarzone && role === "conductor" ? (
              <label className="flex items-start gap-2 text-xs text-hq-fg">
                <input
                  type="checkbox"
                  checked={allowFallback}
                  disabled={disabled}
                  onChange={(event) => setAllowFallback(event.target.checked)}
                  className="mt-0.5"
                />
                <span>{t("allowPollFallback")}</span>
              </label>
            ) : null}
          </div>

          <p className="text-xs text-hq-fg-muted">
            {t("scoreMinimum", {
              minimum:
                formatEventScore(
                  scoreMinimumFor(selection.target || null),
                  locale,
                ) ?? "0",
            })}
          </p>

          {showPreviewStatus && previewState === "loading" ? (
            <p className="text-xs text-hq-fg-muted" role="status">
              {tCommon("loading")}
            </p>
          ) : null}

          {showPreviewStatus && previewState === "error" ? (
            <p className="text-xs text-hq-danger" role="alert">
              {t("actionFailed")}
            </p>
          ) : null}

          {eligibility && !eligibility.ok ? (
            <div
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
              data-testid="trains-event-rule-not-ready"
            >
              <p className="text-sm text-amber-700 dark:text-amber-300">
                {eligibility.reason === "unbound"
                  ? t("eventNotSelected")
                  : t("pendingEvidence")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/tools/video-upload?eventId=${selection.eventId}`}
                  className="rounded-md border border-hq-border px-2.5 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas"
                >
                  {t("uploadEvidence")}
                </Link>
                <Link
                  href={eventHref}
                  className="rounded-md border border-hq-border px-2.5 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas"
                >
                  {t("importFromAshed")}
                </Link>
                <Link
                  href={eventHref}
                  className="rounded-md border border-hq-border px-2.5 py-1 text-xs font-medium text-hq-fg hover:bg-hq-canvas"
                >
                  {t("reviewEvent")}
                </Link>
              </div>
            </div>
          ) : null}

          {eligibility?.ok ? (
            <div
              className="space-y-2 rounded-lg border border-hq-border bg-hq-canvas/60 px-3 py-2.5"
              data-testid="trains-event-rule-preview"
            >
              <p className="text-sm font-medium text-hq-fg">
                {t("eligibilitySummary", {
                  count: eligibility.drawableCount,
                })}
              </p>
              {eligibility.drawableCount > 0 ? (
                <p className="text-xs text-hq-fg-muted">
                  {t("uniformOdds", { count: eligibility.drawableCount })}
                </p>
              ) : null}
              {eligibility.cutoff.applied && eligibility.cutoff.tieExpanded > 0 ? (
                <p className="text-xs text-hq-fg-muted">
                  {t("tiedCutoff", {
                    count: eligibility.candidates.length,
                  })}
                </p>
              ) : null}
              {eligibility.shortBoard ? (
                <p className="text-xs text-hq-fg-muted">
                  {t("shortBoard", { count: eligibility.scoredBoardSize })}
                </p>
              ) : null}
              {rule?.fallback === "confirmed_poll_yes" ? (
                <p className="text-xs text-hq-fg-muted">
                  {t("fallbackInUse")}
                </p>
              ) : null}
              {Object.entries(eligibility.exclusionReasons).map(
                ([reason, count]) =>
                  EXCLUSION_LABEL_KEY[reason] ? (
                    <p key={reason} className="text-xs text-hq-fg-muted">
                      {t(EXCLUSION_LABEL_KEY[reason])}: {count}
                    </p>
                  ) : null,
              )}
              {eligibility.candidates.length > 0 ? (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {eligibility.candidates.map((candidate) => (
                    <li
                      key={candidate.memberId}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-hq-fg">
                          {candidate.memberName ?? candidate.memberId}
                        </span>
                        <span className="shrink-0 rounded-full bg-hq-surface-muted px-1.5 py-0.5 text-[10px] text-hq-fg-muted">
                          {t(candidateBadge(candidate))}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-hq-fg-muted">
                        {formatEventScore(candidate.eventScore, locale) ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            disabled={disabled}
          >
            {tActions("cancel")}
          </Button>
        ) : null}
        {warzoneDefaults ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            data-testid="trains-event-rule-warzone-defaults"
            onClick={() => onApplyBoth?.(warzoneDefaults)}
          >
            {t("warzoneDefaults")}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={disabled || !rule}
          data-testid="trains-event-rule-apply"
          onClick={() => rule && onApply(rule)}
        >
          {tActions("save")}
        </Button>
      </div>
    </div>
  );
}
