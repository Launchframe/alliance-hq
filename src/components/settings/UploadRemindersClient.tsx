"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { ENABLED_SCORE_TARGETS } from "@/lib/video/score-targets";
import type { EurWeeklySlot } from "@/lib/eur/schedule-engine";

type ScheduleRow = {
  id: string;
  scoreTarget: string | null;
  customLabel: string | null;
  scheduleKind: "weekly" | "interval_after_last";
  weeklySlots: EurWeeklySlot[] | null;
  intervalDays: number | null;
  anchorTimeSt: string | null;
  reminderDelayMinutes: number;
  active: boolean;
};

type SubscriptionRow = {
  id: string;
  scoreTarget: string;
  active: boolean;
};

type Props = {
  canManageSchedules: boolean;
};

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function UploadRemindersClient({ canManageSchedules }: Props) {
  const t = useTranslations("uploadReminders");
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const [scheduleKind, setScheduleKind] = useState<"weekly" | "interval_after_last">(
    "weekly",
  );
  const [scoreTarget, setScoreTarget] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [weeklyDow, setWeeklyDow] = useState(0);
  const [weeklyTime, setWeeklyTime] = useState("00:15");
  const [intervalDays, setIntervalDays] = useState(2);
  const [anchorTimeSt, setAnchorTimeSt] = useState("00:15");
  const [reminderDelayMinutes, setReminderDelayMinutes] = useState(60);

  const load = useCallback(async () => {
    try {
      const [schedRes, subRes] = await Promise.all([
        fetch("/api/eur/schedules"),
        fetch("/api/eur/subscriptions"),
      ]);
      if (!schedRes.ok || !subRes.ok) throw new Error(t("loadFailed"));
      const schedData = (await schedRes.json()) as { schedules: ScheduleRow[] };
      const subData = (await subRes.json()) as {
        subscriptions: SubscriptionRow[];
      };
      setSchedules(schedData.schedules);
      setSubscriptions(subData.subscriptions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  function describeSchedule(row: ScheduleRow): string {
    if (row.scheduleKind === "interval_after_last") {
      return t("intervalSummary", {
        days: row.intervalDays ?? 0,
        time: row.anchorTimeSt ?? "",
        delay: row.reminderDelayMinutes,
      });
    }
    const slots = row.weeklySlots ?? [];
    const slotText = slots
      .map((s) => `${DOW_LABELS[s.dow] ?? s.dow} ${s.timeSt}`)
      .join(", ");
    return t("weeklySummary", { slots: slotText, delay: row.reminderDelayMinutes });
  }

  async function createSchedule() {
    setSaving(true);
    setError(null);
    try {
      const payload =
        scheduleKind === "weekly"
          ? {
              scheduleKind,
              scoreTarget: scoreTarget || null,
              customLabel: customLabel || null,
              weeklySlots: [{ dow: weeklyDow, timeSt: weeklyTime }],
              reminderDelayMinutes,
            }
          : {
              scheduleKind,
              scoreTarget: scoreTarget || null,
              customLabel: customLabel || null,
              intervalDays,
              anchorTimeSt,
              reminderDelayMinutes,
            };

      const res = await fetch("/api/eur/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? t("saveFailed"));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleScheduleActive(row: ScheduleRow) {
    setSaving(true);
    try {
      const res = await fetch(`/api/eur/schedules/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...row, active: !row.active }),
      });
      if (!res.ok) throw new Error(t("saveFailed"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteSchedule(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/eur/schedules/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(t("saveFailed"));
      setPendingDeleteId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSubscription(targetId: string, active: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/eur/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoreTarget: targetId, active }),
      });
      if (!res.ok) throw new Error(t("saveFailed"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function isSubscribed(targetId: string): boolean {
    return subscriptions.some((s) => s.scoreTarget === targetId && s.active);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        <p className="mt-2 text-sm">
          <Link href="/inbox" className="text-[#58a6ff] hover:underline">
            {t("openInbox")}
          </Link>
        </p>
      </div>

      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("personalTitle")}</h2>
        <p className="text-sm text-[#8b949e]">{t("personalBody")}</p>
        <ul className="divide-y divide-[#30363d] rounded-xl border border-[#30363d] bg-[#161b22]">
          {ENABLED_SCORE_TARGETS.map((target) => (
            <li
              key={target.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0 truncate text-sm">{target.id}</span>
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void toggleSubscription(target.id, !isSubscribed(target.id))
                }
                className="shrink-0 rounded-lg border border-[#30363d] px-3 py-1 text-sm hover:bg-[#21262d] disabled:opacity-50"
              >
                {isSubscribed(target.id) ? t("subscribed") : t("subscribe")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {canManageSchedules ? (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-medium">{t("allianceTitle")}</h2>
            <p className="text-sm text-[#8b949e]">{t("allianceBody")}</p>
            {schedules.length === 0 ? (
              <p className="text-sm text-[#8b949e]">{t("noSchedules")}</p>
            ) : (
              <ul className="divide-y divide-[#30363d] rounded-xl border border-[#30363d] bg-[#161b22]">
                {schedules.map((row) => (
                  <li key={row.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {row.customLabel ?? row.scoreTarget ?? t("unnamedEvent")}
                        </p>
                        <p className="text-sm text-[#8b949e]">
                          {describeSchedule(row)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void toggleScheduleActive(row)}
                          className="rounded-lg border border-[#30363d] px-2 py-1 text-xs hover:bg-[#21262d] disabled:opacity-50"
                        >
                          {row.active ? t("active") : t("paused")}
                        </button>
                        {pendingDeleteId === row.id ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void deleteSchedule(row.id)}
                              className="rounded-lg border border-[#f85149] px-2 py-1 text-xs text-[#f85149] hover:bg-[#21262d] disabled:opacity-50"
                            >
                              {t("confirmDelete")}
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => setPendingDeleteId(null)}
                              className="rounded-lg border border-[#30363d] px-2 py-1 text-xs hover:bg-[#21262d] disabled:opacity-50"
                            >
                              {t("cancelDelete")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => setPendingDeleteId(row.id)}
                            className="rounded-lg border border-[#30363d] px-2 py-1 text-xs text-[#f85149] hover:bg-[#21262d] disabled:opacity-50"
                          >
                            {t("delete")}
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5">
            <h2 className="font-medium">{t("addSchedule")}</h2>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                preventDefaultFormSubmit(event);
                void createSchedule();
              }}
            >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-[#8b949e]">{t("scheduleKind")}</span>
                <select
                  value={scheduleKind}
                  onChange={(e) =>
                    setScheduleKind(
                      e.target.value as "weekly" | "interval_after_last",
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                >
                  <option value="weekly">{t("kindWeekly")}</option>
                  <option value="interval_after_last">{t("kindInterval")}</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-[#8b949e]">{t("scoreTarget")}</span>
                <select
                  value={scoreTarget}
                  onChange={(e) => setScoreTarget(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                >
                  <option value="">{t("customEvent")}</option>
                  {ENABLED_SCORE_TARGETS.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.id}
                    </option>
                  ))}
                </select>
              </label>
              {!scoreTarget ? (
                <label className="block text-sm sm:col-span-2">
                  <span className="text-[#8b949e]">{t("customLabel")}</span>
                  <input
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                  />
                </label>
              ) : null}
              {scheduleKind === "weekly" ? (
                <>
                  <label className="block text-sm">
                    <span className="text-[#8b949e]">{t("dayOfWeek")}</span>
                    <select
                      value={weeklyDow}
                      onChange={(e) => setWeeklyDow(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                    >
                      {DOW_LABELS.map((label, i) => (
                        <option key={label} value={i}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="text-[#8b949e]">{t("startTime")}</span>
                    <input
                      type="time"
                      value={weeklyTime}
                      onChange={(e) => setWeeklyTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                    />
                  </label>
                </>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="text-[#8b949e]">{t("intervalDays")}</span>
                    <input
                      type="number"
                      min={1}
                      value={intervalDays}
                      onChange={(e) =>
                        setIntervalDays(Number.parseInt(e.target.value, 10) || 1)
                      }
                      className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-[#8b949e]">{t("startTime")}</span>
                    <input
                      type="time"
                      value={anchorTimeSt}
                      onChange={(e) => setAnchorTimeSt(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                    />
                  </label>
                </>
              )}
              <label className="block text-sm sm:col-span-2">
                <span className="text-[#8b949e]">{t("reminderDelay")}</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={reminderDelayMinutes}
                  onChange={(e) =>
                    setReminderDelayMinutes(
                      Number.parseInt(e.target.value, 10) || 0,
                    )
                  }
                  enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                  className="mt-1 w-full max-w-xs rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50"
            >
              {t("saveSchedule")}
            </button>
            </form>
          </section>
        </>
      ) : null}
    </div>
  );
}
