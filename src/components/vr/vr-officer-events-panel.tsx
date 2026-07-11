"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  coerceInstituteLevelFromBaseVr,
  validateInstituteLevelForSeason,
} from "@/lib/vr/validation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";

type OfficerEvent = {
  id: string;
  baseVr: number;
  instituteLevel: number | null;
  previousBaseVr: number | null;
  source: string;
  createdAt: string;
};

type Props = {
  seasonKey: string;
  ashedMemberId: string;
  memberName: string;
  onBack: () => void;
  onChanged?: () => void | Promise<void>;
};

function draftsFromEvents(
  seasonKey: string,
  events: OfficerEvent[],
): Record<string, string> {
  return Object.fromEntries(
    events.map((event) => [
      event.id,
      String(
        event.instituteLevel ??
          coerceInstituteLevelFromBaseVr(seasonKey, event.baseVr),
      ),
    ]),
  );
}

export function VrOfficerEventsPanel({
  seasonKey,
  ashedMemberId,
  memberName,
  onBack,
  onChanged,
}: Props) {
  const t = useTranslations("viralResistance.officer");
  const [events, setEvents] = useState<OfficerEvent[] | null>(null);
  const [draftLevels, setDraftLevels] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/vr/officer/events?ashedMemberId=${encodeURIComponent(ashedMemberId)}`,
        );
        const body = (await res.json()) as {
          events?: OfficerEvent[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setMessage(body.error ?? t("eventsFailed"));
          setEvents(null);
          return;
        }
        const next = body.events ?? [];
        setEvents(next);
        setDraftLevels(draftsFromEvents(seasonKey, next));
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : t("eventsFailed"));
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ashedMemberId, seasonKey, t]);

  const reloadEvents = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/vr/officer/events?ashedMemberId=${encodeURIComponent(ashedMemberId)}`,
      );
      const body = (await res.json()) as {
        events?: OfficerEvent[];
        error?: string;
      };
      if (!res.ok) {
        setMessage(body.error ?? t("eventsFailed"));
        setEvents(null);
        return;
      }
      const next = body.events ?? [];
      setEvents(next);
      setDraftLevels(draftsFromEvents(seasonKey, next));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("eventsFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  const saveEvent = async (eventId: string) => {
    const instituteLevel = Number.parseInt(draftLevels[eventId] ?? "", 10);
    const validated = validateInstituteLevelForSeason(seasonKey, instituteLevel);
    if (!validated.ok) {
      setMessage(t("eventsInvalid"));
      return;
    }
    setBusyId(eventId);
    setMessage(null);
    try {
      const res = await fetch("/api/vr/officer/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          instituteLevel: validated.instituteLevel,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(body.error ?? t("eventsFailed"));
        return;
      }
      setMessage(t("eventsSaved"));
      await reloadEvents();
      await onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("eventsFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const deleteEvent = async (eventId: string) => {
    setBusyId(eventId);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/vr/officer/events?eventId=${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      );
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(body.error ?? t("eventsFailed"));
        return;
      }
      setMessage(t("eventsDeleted"));
      await reloadEvents();
      await onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("eventsFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="min-w-0">
        <button
          type="button"
          data-testid="vr-officer-events-back"
          onClick={onBack}
          className="mb-3 flex items-center gap-1 self-start text-xs text-hq-fg-muted transition-colors hover:text-hq-fg"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t("eventsBack")}
        </button>
        <h1 className="text-2xl font-semibold text-hq-fg">
          {t("eventsMemberTitle", { name: memberName })}
        </h1>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("eventsSubtitle")}</p>
      </header>

      {initialLoading ? (
        <p className="text-sm text-hq-fg-muted">{t("eventsLoading")}</p>
      ) : events ? (
        events.length === 0 ? (
          <p className="text-sm text-hq-fg-muted">{t("eventsEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-hq-border bg-hq-surface">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-hq-border text-xs uppercase tracking-wide text-hq-fg-muted">
                <tr>
                  <th className="px-4 py-3">{t("eventsColDate")}</th>
                  <th className="px-4 py-3">{t("eventsColLevel")}</th>
                  <th className="px-4 py-3">{t("eventsColVr")}</th>
                  <th className="px-4 py-3">{t("eventsColSource")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {[...events].reverse().map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-hq-surface-muted last:border-0"
                  >
                    <td className="px-4 py-3 text-hq-fg-muted">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        value={draftLevels[event.id] ?? ""}
                        onChange={(e) =>
                          setDraftLevels((current) => ({
                            ...current,
                            [event.id]: e.target.value,
                          }))
                        }
                        inputMode="numeric"
                        enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                        className="w-20 rounded border border-hq-border bg-hq-surface px-2 py-1 font-mono text-hq-fg"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-hq-fg">
                      {event.baseVr.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-hq-fg-muted">{event.source}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === event.id || refreshing}
                          onClick={() => void saveEvent(event.id)}
                          className="rounded border border-hq-border px-2 py-1 text-xs text-hq-fg disabled:opacity-50"
                        >
                          {t("eventsEdit")}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === event.id || refreshing}
                          onClick={() => void deleteEvent(event.id)}
                          className="rounded border border-hq-danger/40 px-2 py-1 text-xs text-hq-danger disabled:opacity-50"
                        >
                          {busyId === event.id
                            ? t("eventsDeleting")
                            : t("eventsDelete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {message ? (
        <p className="text-sm text-hq-fg-muted">{message}</p>
      ) : null}
    </div>
  );
}
