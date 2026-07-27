"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import {
  VS_DEMOTION_TASK_KIND,
  VS_KICK_TASK_KIND,
} from "@/lib/vs-compliance/evaluate.shared";
import type { SerializedVsComplianceEvent } from "@/lib/vs-compliance/types.shared";

type EventWithKind = SerializedVsComplianceEvent & {
  taskKind: typeof VS_DEMOTION_TASK_KIND | typeof VS_KICK_TASK_KIND;
};

type Props = {
  initialEvents: EventWithKind[];
};

/**
 * Officer-facing list of open VS membership compliance tasks. Officers
 * demote/kick the member in-game themselves — this page is informational
 * and only supports Mark complete (they handled it) or Waive (excuse the
 * miss). It never calls confirmMemberRank or any other Ashed write.
 */
export function VsComplianceClient({ initialEvents }: Props) {
  const t = useTranslations("vsCompliance");
  const [events, setEvents] = useState<EventWithKind[]>(initialEvents);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiveTarget, setWaiveTarget] = useState<EventWithKind | null>(null);
  const [waiveReason, setWaiveReason] = useState("");
  const [waiveBusy, setWaiveBusy] = useState(false);
  const [waiveError, setWaiveError] = useState<string | null>(null);

  const removeEvent = useCallback((id: string) => {
    setEvents((prev) => prev.filter((event) => event.id !== id));
  }, []);

  async function markComplete(event: EventWithKind) {
    setBusyId(event.id);
    setError(null);
    try {
      const res = await fetch(`/api/vs-compliance/events/${event.id}/complete`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || t("markCompleteFailed"));
      }
      removeEvent(event.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("markCompleteFailed"));
    } finally {
      setBusyId(null);
    }
  }

  function openWaiveDialog(event: EventWithKind) {
    setWaiveTarget(event);
    setWaiveReason("");
    setWaiveError(null);
  }

  async function submitWaive() {
    if (!waiveTarget) return;
    const reason = waiveReason.trim();
    if (!reason) {
      setWaiveError(t("waiveReasonRequired"));
      return;
    }
    setWaiveBusy(true);
    setWaiveError(null);
    try {
      const res = await fetch(`/api/vs-compliance/events/${waiveTarget.id}/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || t("waiveFailed"));
      }
      removeEvent(waiveTarget.id);
      setWaiveTarget(null);
    } catch (err) {
      setWaiveError(err instanceof Error ? err.message : t("waiveFailed"));
    } finally {
      setWaiveBusy(false);
    }
  }

  function taskTitle(event: EventWithKind): string {
    return event.taskKind === VS_KICK_TASK_KIND
      ? t("taskKickTitle", { name: event.memberName })
      : t("taskDemotionTitle", { name: event.memberName });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
      </div>

      {error ? <p className="text-sm text-hq-danger">{error}</p> : null}

      {events.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-hq-border rounded-xl border border-hq-border bg-hq-surface">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-hq-accent">
                  {event.taskKind === VS_KICK_TASK_KIND
                    ? t("kindKick")
                    : t("kindDemotion")}
                </p>
                <p className="font-medium text-hq-fg">{taskTitle(event)}</p>
                <p className="mt-1 text-sm text-hq-fg-muted">
                  {t("weekSummary", {
                    weekEnding: event.vsWeekEnding,
                    score: event.score.toLocaleString(),
                    threshold: event.threshold.toLocaleString(),
                  })}
                </p>
                {event.strikeNumber ? (
                  <p className="mt-1 text-xs text-hq-fg-muted">
                    {t("strikeCount", { count: event.strikeNumber })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === event.id}
                  onClick={() => void markComplete(event)}
                  className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
                >
                  {t("markComplete")}
                </button>
                <button
                  type="button"
                  disabled={busyId === event.id}
                  onClick={() => openWaiveDialog(event)}
                  className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
                >
                  {t("waive")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={waiveTarget != null}
        onOpenChange={(next) => {
          if (!next && !waiveBusy) setWaiveTarget(null);
        }}
        title={t("waiveDialogTitle")}
      >
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold text-hq-fg">
              {t("waiveDialogTitle")}
            </h2>
            {waiveTarget ? (
              <p className="mt-2 text-sm text-hq-fg-muted">
                {t("waiveDialogBody", { name: waiveTarget.memberName })}
              </p>
            ) : null}
          </div>

          <label className="block text-sm">
            <span className="text-hq-fg-muted">{t("waiveReasonLabel")}</span>
            <textarea
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              disabled={waiveBusy}
              rows={3}
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-hq-fg disabled:opacity-60"
            />
          </label>

          {waiveError ? (
            <p className="text-sm text-hq-danger">{waiveError}</p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={waiveBusy}
              onClick={() => setWaiveTarget(null)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={waiveBusy}
              onClick={() => void submitWaive()}
              className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
            >
              {waiveBusy ? t("waiving") : t("waiveConfirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
