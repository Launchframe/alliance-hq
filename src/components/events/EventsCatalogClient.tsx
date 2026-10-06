"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  EVENT_FAMILY_POLICY,
  type EventTarget,
} from "@/lib/hq-events/event-types.shared";
import type { EventCatalogItem } from "@/lib/hq-events/workspace.shared";

const FAMILY_OPTIONS: { value: EventTarget; labelKey: string; nav?: boolean }[] = [
  { value: "warzone-duel", labelKey: "warzoneDuel" },
  { value: "frontline-breakthrough", labelKey: "frontlineBreakthrough", nav: true },
  { value: "seasonal", labelKey: "seasonal", nav: true },
  { value: "desert-storm", labelKey: "desertStorm", nav: true },
  { value: "canyon-storm", labelKey: "canyonStorm", nav: true },
];

function familyLabel(
  target: EventTarget | null,
  t: ReturnType<typeof useTranslations>,
  tNav: ReturnType<typeof useTranslations>,
): string {
  const option = FAMILY_OPTIONS.find((o) => o.value === target);
  if (!option) return target ?? "";
  return option.nav ? tNav(option.labelKey) : t(option.labelKey);
}

export function EventsCatalogClient({
  canWriteEvents = false,
}: {
  /** `hq:events:write` — shows the add-event form. */
  canWriteEvents?: boolean;
}) {
  const t = useTranslations("eventEvidence");
  const tNav = useTranslations("nav");
  const tMembers = useTranslations("members");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("vsPerformance.actions");
  const tVideo = useTranslations("videoReview");

  const [family, setFamily] = useState("");
  const [date, setDate] = useState("");
  const [events, setEvents] = useState<EventCatalogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newFamily, setNewFamily] = useState<EventTarget | "">("");
  const [newSeries, setNewSeries] = useState("");
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState(false);

  const createEvent = async () => {
    if (!newFamily || !newSeries.trim() || !newName.trim() || !newDate) return;
    setCreatePending(true);
    setCreateError(false);
    try {
      const existingSeriesId =
        events.find(
          (event) =>
            event.target === newFamily &&
            event.seriesName?.toLowerCase() ===
              newSeries.trim().toLowerCase(),
        )?.seriesId ?? null;
      const res = await fetch("/api/hq-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(existingSeriesId
            ? { seriesId: existingSeriesId }
            : {
                series: { name: newSeries.trim(), target: newFamily },
              }),
          name: newName.trim(),
          startDate: newDate,
          boards: EVENT_FAMILY_POLICY[newFamily].teamScoped
            ? [
                { boardKey: "a", name: tVideo("teamA") },
                { boardKey: "b", name: tVideo("teamB") },
              ]
            : undefined,
        }),
      });
      if (!res.ok) {
        setCreateError(true);
        return;
      }
      setCreateOpen(false);
      setNewFamily("");
      setNewSeries("");
      setNewName("");
      setNewDate("");
      setLoading(true);
      void load(null, false).finally(() => setLoading(false));
    } catch {
      setCreateError(true);
    } finally {
      setCreatePending(false);
    }
  };

  const load = useCallback(
    (cursor: string | null, append: boolean) => {
      const params = new URLSearchParams({ limit: "50" });
      if (family) params.set("family", family);
      if (cursor) params.set("cursor", cursor);
      return fetch(`/api/hq-events?${params}`, { cache: "no-store" })
        .then(async (res) => {
          const body = await res.json().catch(() => null);
          if (!res.ok) throw new Error("load_failed");
          return body;
        })
        .then((body) => {
          const items = (body?.events ?? []) as EventCatalogItem[];
          setEvents((prev) => (append ? [...prev, ...items] : items));
          setNextCursor(body?.nextCursor ?? null);
          setError(false);
        })
        .catch(() => setError(true));
    },
    [family],
  );

  useEffect(() => {
    let cancelled = false;
    void load(null, false).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const filtered = useMemo(
    () =>
      date
        ? events.filter(
            (event) =>
              event.startDate === date ||
              (event.startDate != null &&
                event.endDate != null &&
                event.startDate <= date &&
                event.endDate >= date),
          )
        : events,
    [events, date],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <AppSelect
            value={family}
            onChange={setFamily}
            options={[
              { value: "", label: t("chooseEvent") },
              ...FAMILY_OPTIONS.map((o) => ({
                value: o.value,
                label: o.nav ? tNav(o.labelKey) : t(o.labelKey),
              })),
            ]}
            searchable
            searchPlaceholder={tMembers("search")}
            aria-label={t("chooseEvent")}
          />
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
          aria-label={t("chooseOccurrence")}
        />
        {canWriteEvents ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="events-add-event-toggle"
            onClick={() => setCreateOpen((open) => !open)}
          >
            {t("addEvent")}
          </Button>
        ) : null}
      </div>
      {canWriteEvents && createOpen ? (
        <div
          className="space-y-3 rounded-lg border border-hq-border bg-hq-surface p-4"
          data-testid="events-add-event-form"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-hq-fg-muted">
              {t("chooseEvent")}
              <div className="mt-1">
                <AppSelect
                  value={newFamily}
                  onChange={(value) => setNewFamily(value as EventTarget)}
                  options={FAMILY_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.nav ? tNav(o.labelKey) : t(o.labelKey),
                  }))}
                  aria-label={t("chooseEvent")}
                />
              </div>
            </label>
            <label className="block text-xs font-medium text-hq-fg-muted">
              {t("eventSeries")}
              <input
                type="text"
                value={newSeries}
                onChange={(e) => setNewSeries(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              />
            </label>
            <label className="block text-xs font-medium text-hq-fg-muted">
              {t("eventName")}
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              />
            </label>
            <label className="block text-xs font-medium text-hq-fg-muted">
              {t("eventDate")}
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              />
            </label>
          </div>
          {createError ? (
            <p role="alert" className="text-xs text-hq-danger">
              {t("actionFailed")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              {tActions("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                createPending ||
                !newFamily ||
                !newSeries.trim() ||
                !newName.trim() ||
                !newDate
              }
              data-testid="events-add-event-submit"
              onClick={() => void createEvent()}
            >
              {t("addEvent")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-hq-danger">
          {t("actionFailed")}
        </p>
      ) : null}
      {!loading && !error && filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hq-border px-4 py-8 text-center text-sm text-hq-fg-muted">
          {t("emptyCatalog")}
        </p>
      ) : null}
      <ul className="divide-y divide-hq-border rounded-lg border border-hq-border bg-hq-surface">
        {filtered.map((event) => (
          <li key={event.id}>
            <Link
              href={`/events/${event.id}`}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-hq-surface-muted"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-hq-fg">
                  {event.name}
                </span>
                <span className="text-xs text-hq-fg-muted">
                  {[
                    familyLabel(event.target, t, tNav),
                    event.seriesName,
                    event.startDate,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="text-xs text-hq-fg-muted">
                {event.readyBoards}/{event.boardCount} · {t("readyForDraws")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {loading ? (
        <p className="text-sm text-hq-fg-muted">{tCommon("loading")}</p>
      ) : null}
      {nextCursor && !loading ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setLoading(true);
            void load(nextCursor, true).finally(() => setLoading(false));
          }}
        >
          {tCommon("next")}
        </Button>
      ) : null}
    </div>
  );
}
