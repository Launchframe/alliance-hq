"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  EVENT_FAMILY_POLICY,
  EVENT_TARGETS,
  type EventTarget,
} from "@/lib/hq-events/event-types.shared";
import type {
  EventBoardDto,
  EventCatalogItem,
} from "@/lib/hq-events/workspace.shared";
import { boardTeamScope } from "@/lib/hq-events/workspace.shared";

export type EventSourceSelection = {
  target: EventTarget | "";
  seriesId: string;
  eventId: string;
  boardId: string;
  teamScope: "A" | "B" | "both" | "";
};

export const EMPTY_EVENT_SOURCE_SELECTION: EventSourceSelection = {
  target: "",
  seriesId: "",
  eventId: "",
  boardId: "",
  teamScope: "",
};

type Props = {
  value: EventSourceSelection;
  onChange: (next: EventSourceSelection) => void;
  disabled?: boolean;
  /**
   * Template mode captures a family/series intent only — the occurrence and
   * board selects stay hidden so a template can never bind a specific event.
   */
  templateMode?: boolean;
};

export const FAMILY_LABEL_KEY: Record<
  EventTarget,
  { ns: "eventEvidence" | "nav"; key: string }
> = {
  "warzone-duel": { ns: "eventEvidence", key: "warzoneDuel" },
  "frontline-breakthrough": { ns: "nav", key: "frontlineBreakthrough" },
  seasonal: { ns: "nav", key: "seasonal" },
  "desert-storm": { ns: "nav", key: "desertStorm" },
  "canyon-storm": { ns: "nav", key: "canyonStorm" },
};

/**
 * Controlled family → series → occurrence → board/team picker fed by the
 * event catalog APIs. No auto-selection; changing a parent clears dependents
 * (with a confirmation when unsaved selections would be lost).
 */
export function EventSourcePicker({
  value,
  onChange,
  disabled,
  templateMode = false,
}: Props) {
  const t = useTranslations("eventEvidence");
  const tNav = useTranslations("nav");
  const tMembers = useTranslations("members");
  const tVideo = useTranslations("videoReview");
  const tActions = useTranslations("vsPerformance.actions");

  const [catalog, setCatalog] = useState<{
    target: EventTarget;
    events: EventCatalogItem[];
  } | null>(null);
  const [boards, setBoards] = useState<{
    eventId: string;
    boards: EventBoardDto[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<
    (() => void) | null
  >(null);

  useEffect(() => {
    if (!value.target) return;
    let cancelled = false;
    const target = value.target;
    const params = new URLSearchParams({ family: target, limit: "100" });
    fetch(`/api/hq-events?${params}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "load_failed");
        return body;
      })
      .then((body) => {
        if (!cancelled)
          setCatalog({ target, events: body?.events ?? [] });
      })
      .catch(() => {
        if (!cancelled) setError("load_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [value.target]);

  useEffect(() => {
    if (!value.eventId) return;
    let cancelled = false;
    const eventId = value.eventId;
    fetch(`/api/hq-events/${eventId}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? "load_failed");
        return body;
      })
      .then((body) => {
        if (!cancelled)
          setBoards({ eventId, boards: body?.boards ?? [] });
      })
      .catch(() => {
        if (!cancelled) setBoards({ eventId, boards: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [value.eventId]);

  const eventsForTarget = useMemo(
    () =>
      catalog && catalog.target === value.target ? catalog.events : [],
    [catalog, value.target],
  );
  const boardsForEvent =
    boards && boards.eventId === value.eventId ? boards.boards : [];

  const seriesOptions = useMemo(() => {
    const aliases = value.target
      ? EVENT_FAMILY_POLICY[value.target].searchAliases.join(" ")
      : "";
    const seen = new Map<
      string,
      { value: string; label: string; searchText: string }
    >();
    for (const event of eventsForTarget) {
      if (!event.seriesId) continue;
      const name = event.seriesName ?? event.seriesId;
      if (!seen.has(event.seriesId)) {
        seen.set(event.seriesId, {
          value: event.seriesId,
          label: name,
          searchText: `${name} ${aliases}`,
        });
      }
    }
    return [...seen.values()];
  }, [eventsForTarget, value.target]);

  const occurrenceOptions = useMemo(
    () =>
      eventsForTarget
        .filter((event) => event.seriesId === value.seriesId)
        .map((event) => ({
          value: event.id,
          label: `${event.name}${event.startDate ? ` · ${event.startDate}` : ""}`,
        })),
    [eventsForTarget, value.seriesId],
  );

  const teamScoped = value.target
    ? EVENT_FAMILY_POLICY[value.target].teamScoped
    : false;

  /** Clear-and-set helper: confirm first when dependents would be lost. */
  const requestChange = (hasDependents: boolean, apply: () => void) => {
    if (!hasDependents) {
      apply();
      return;
    }
    setPendingChange(() => apply);
  };

  const familyOptions = EVENT_TARGETS.map((target) => {
    const key = FAMILY_LABEL_KEY[target];
    return {
      value: target,
      label: key.ns === "nav" ? tNav(key.key) : t(key.key),
    };
  });

  const boardOptions = boardsForEvent.map((board) => {
    const scope = boardTeamScope(board.boardKey);
    return {
      value: board.id,
      label:
        scope === "A"
          ? tVideo("teamA")
          : scope === "B"
            ? tVideo("teamB")
            : board.name ?? board.boardKey,
    };
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <AppSelect
          value={value.target}
          onChange={(target) => {
            if (target === value.target) return;
            requestChange(
              Boolean(value.seriesId || value.eventId || value.boardId),
              () => {
                setError(null);
                onChange({
                  ...EMPTY_EVENT_SOURCE_SELECTION,
                  target: target as EventTarget,
                });
              },
            );
          }}
          options={familyOptions}
          placeholder={t("chooseEvent")}
          searchable
          searchPlaceholder={tMembers("search")}
          disabled={disabled}
          aria-label={t("chooseEvent")}
        />
        <AppSelect
          value={value.seriesId}
          onChange={(seriesId) => {
            if (seriesId === value.seriesId) return;
            requestChange(Boolean(value.eventId || value.boardId), () =>
              onChange({
                ...value,
                seriesId,
                eventId: "",
                boardId: "",
                teamScope: "",
              }),
            );
          }}
          options={seriesOptions}
          placeholder={t("chooseEvent")}
          searchable
          searchPlaceholder={tMembers("search")}
          disabled={disabled || !value.target}
          aria-label={t("chooseEvent")}
        />
      </div>
      {value.target === "warzone-duel" ? (
        <p className="text-xs text-hq-fg-muted">{t("warzoneAliases")}</p>
      ) : null}
      {templateMode ? null : (
        <>
          <AppSelect
            value={value.eventId}
            onChange={(eventId) => {
              if (eventId === value.eventId) return;
              requestChange(Boolean(value.boardId), () =>
                onChange({ ...value, eventId, boardId: "", teamScope: "" }),
              );
            }}
            options={occurrenceOptions}
            placeholder={t("chooseOccurrence")}
            searchable
            searchPlaceholder={tMembers("search")}
            disabled={disabled || !value.seriesId}
            aria-label={t("chooseOccurrence")}
          />
          <p className="text-xs text-hq-fg-muted">
            {t("chooseOccurrenceHint")}
          </p>
        </>
      )}
      {value.eventId || (templateMode && teamScoped) ? (
        teamScoped ? (
          <div className="space-y-1">
            <AppSelect
              value={value.teamScope}
              onChange={(teamScope) =>
                onChange({
                  ...value,
                  teamScope: teamScope as EventSourceSelection["teamScope"],
                })
              }
              options={[
                { value: "both", label: t("bothTeams") },
                { value: "A", label: tVideo("teamA") },
                { value: "B", label: tVideo("teamB") },
              ]}
              placeholder={t("bothTeams")}
              disabled={disabled}
              aria-label={t("bothTeams")}
            />
            {value.teamScope === "both" ? (
              <p className="text-xs text-hq-fg-muted">{t("bothTeamsHint")}</p>
            ) : null}
          </div>
        ) : boardsForEvent.length > 1 ? (
          <AppSelect
            value={value.boardId}
            onChange={(boardId) => onChange({ ...value, boardId })}
            options={boardOptions}
            placeholder={t("chooseBoard")}
            disabled={disabled}
            aria-label={t("chooseBoard")}
          />
        ) : null
      ) : null}
      {error ? (
        <p className="text-xs text-hq-danger" role="alert">
          {t("actionFailed")}
        </p>
      ) : null}
      <Dialog
        open={pendingChange != null}
        onOpenChange={(open) => {
          if (!open) setPendingChange(null);
        }}
        title={t("chooseEvent")}
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-hq-fg">{t("changedEventReview")}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPendingChange(null)}
            >
              {tActions("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const apply = pendingChange;
                setPendingChange(null);
                apply?.();
              }}
            >
              {tActions("save")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
