"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect, type AppSelectOption } from "@/components/ui/AppSelect";
import { coerceInstituteLevelFromBaseVr } from "@/lib/vr/validation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
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
  memberOptions: AppSelectOption[];
  onChanged?: () => void | Promise<void>;
};

export function VrOfficerEventsPanel({
  seasonKey,
  memberOptions,
  onChanged,
}: Props) {
  const t = useTranslations("viralResistance.officer");
  const [memberId, setMemberId] = useState("");
  const [events, setEvents] = useState<OfficerEvent[] | null>(null);
  const [draftLevels, setDraftLevels] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadEvents = async () => {
    if (!memberId) {
      setMessage(t("invalid"));
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/vr/officer/events?ashedMemberId=${encodeURIComponent(memberId)}`,
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
      setDraftLevels(
        Object.fromEntries(
          next.map((event) => [
            event.id,
            String(
              event.instituteLevel ??
                coerceInstituteLevelFromBaseVr(seasonKey, event.baseVr),
            ),
          ]),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("eventsFailed"));
    } finally {
      setLoading(false);
    }
  };

  const saveEvent = async (eventId: string) => {
    const instituteLevel = Number.parseInt(draftLevels[eventId] ?? "", 10);
    if (!Number.isFinite(instituteLevel)) {
      setMessage(t("invalid"));
      return;
    }
    setBusyId(eventId);
    setMessage(null);
    try {
      const res = await fetch("/api/vr/officer/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, instituteLevel }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMessage(body.error ?? t("eventsFailed"));
        return;
      }
      setMessage(t("eventsSaved"));
      await loadEvents();
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
      await loadEvents();
      await onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("eventsFailed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-8 border-t border-hq-border pt-6">
      <h3 className="text-base font-semibold text-hq-fg">{t("eventsTitle")}</h3>
      <p className="mt-1 text-sm text-hq-fg-muted">{t("eventsSubtitle")}</p>

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void loadEvents();
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-hq-fg-muted">
          {t("member")}
          <AppSelect
            value={memberId}
            onChange={setMemberId}
            options={memberOptions}
            searchable
            placeholder={t("memberPlaceholder")}
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg disabled:opacity-50"
        >
          {loading ? t("eventsLoading") : t("eventsLoad")}
        </button>
      </form>

      {events ? (
        events.length === 0 ? (
          <p className="mt-4 text-sm text-hq-fg-muted">{t("eventsEmpty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-hq-border">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-hq-border text-xs uppercase tracking-wide text-hq-fg-muted">
                <tr>
                  <th className="px-3 py-2">{t("eventsColDate")}</th>
                  <th className="px-3 py-2">{t("eventsColLevel")}</th>
                  <th className="px-3 py-2">{t("eventsColVr")}</th>
                  <th className="px-3 py-2">{t("eventsColSource")}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {[...events].reverse().map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-hq-surface-muted last:border-0"
                  >
                    <td className="px-3 py-2 text-hq-fg-muted">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
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
                    <td className="px-3 py-2 font-mono text-hq-fg">
                      {event.baseVr.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-hq-fg-muted">{event.source}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === event.id}
                          onClick={() => void saveEvent(event.id)}
                          className="rounded border border-hq-border px-2 py-1 text-xs text-hq-fg disabled:opacity-50"
                        >
                          {t("eventsEdit")}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === event.id}
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
        <p className="mt-3 text-sm text-hq-fg-muted">{message}</p>
      ) : null}
    </div>
  );
}
