"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ConductorWheelModal } from "@/components/trains/ConductorWheelModal";
import { TodayConductorCard } from "@/components/trains/TodayConductorCard";
import {
  WeekScheduleStrip,
  canSpinConductor,
  canSpinVip,
} from "@/components/trains/WeekScheduleStrip";
import { Link } from "@/i18n/navigation";
import type { TrainsDashboardPayload } from "@/lib/trains/load-dashboard";
import type { WeekTemplateType } from "@/lib/trains/types";

type Props = {
  initial: TrainsDashboardPayload;
};

type RollResponse = {
  result?: {
    memberId: string;
    memberName: string;
    isAutomatic?: boolean;
  };
  stats?: {
    lastConductedDate: string | null;
    conductsThisYear: number;
  };
  error?: string;
};

const TEMPLATE_OPTIONS: WeekTemplateType[] = [
  "vs_push_week",
  "economy_week",
  "r3_recognition",
  "r4_train_week",
  "donations_week",
];

export function TrainsDashboard({ initial }: Props) {
  const t = useTranslations("trains");
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelWinner, setWheelWinner] = useState<{
    memberId: string;
    memberName: string;
  } | null>(null);
  const [wheelStats, setWheelStats] = useState<
    RollResponse["stats"] | null
  >(null);
  const [wheelCandidates, setWheelCandidates] = useState<
    Array<{ memberId: string; memberName: string }>
  >([]);

  const conductorShortLabels = useMemo(
    () => ({
      vs_high_score: t("mechanismsShort.vsHighScore"),
      vs_top_10: t("mechanismsShort.vsTop10"),
      r3_lottery: t("mechanismsShort.r3Lottery"),
      r4_sequence: t("mechanismsShort.r4Sequence"),
      donations_top: t("mechanismsShort.donationsTop"),
      officer_pick: t("mechanismsShort.officerPick"),
      event_top_x_lottery: t("mechanismsShort.eventTopX"),
      custom: t("mechanismsShort.custom"),
    }),
    [t],
  );

  const vipShortLabels = useMemo(
    () => ({
      conductor_pick: t("vipMechanismsShort.conductorPick"),
      donations_second: t("vipMechanismsShort.donationsSecond"),
      event_top_x_lottery: t("vipMechanismsShort.eventTopX"),
    }),
    [t],
  );

  const refresh = useCallback(async () => {
    const res = await fetch("/api/trains/schedule");
    const body = (await res.json()) as TrainsDashboardPayload & { error?: string };
    if (!res.ok) {
      setError(body.error ?? t("loadFailed"));
      return;
    }
    setData(body);
    setError(null);
  }, [t]);

  const runRoll = async (role: "conductor" | "vip") => {
    setBusy(role);
    setError(null);
    try {
      const res = await fetch("/api/trains/conductor/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = (await res.json()) as RollResponse;
      if (!res.ok || !body.result) {
        setError(body.error ?? t("rollFailed"));
        return;
      }

      await refresh();

      if (body.result.isAutomatic) {
        return;
      }

      setWheelCandidates([
        { memberId: body.result.memberId, memberName: body.result.memberName },
      ]);
      setWheelWinner(body.result);
      setWheelStats(body.stats ?? null);
      setWheelOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("rollFailed"));
    } finally {
      setBusy(null);
    }
  };

  const lockConductor = async () => {
    setBusy("lock");
    setError(null);
    try {
      const res = await fetch("/api/trains/conductor/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("lockFailed"));
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("lockFailed"));
    } finally {
      setBusy(null);
    }
  };

  const changeTemplate = async (templateType: WeekTemplateType) => {
    setBusy("schedule");
    setError(null);
    try {
      const res = await fetch("/api/trains/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateType, weekStart: data.weekStart }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("scheduleFailed"));
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("scheduleFailed"));
    } finally {
      setBusy(null);
    }
  };

  const reseedPool = async (poolType: string) => {
    setBusy("pool");
    setError(null);
    try {
      const res = await fetch("/api/trains/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poolType }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("poolFailed"));
        return;
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("poolFailed"));
    } finally {
      setBusy(null);
    }
  };

  if (data.activeMemberCount === 0) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 sm:p-6">
        <header>
          <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </header>
        <section className="rounded-2xl border border-[#30363d] bg-[#161b22] p-6 text-center">
          <p className="text-sm text-[#c9d1d9]">{t("emptyRosterBody")}</p>
          <Link
            href="/members"
            className="mt-4 inline-flex rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043]"
          >
            {t("emptyRosterCta")}
          </Link>
        </section>
      </div>
    );
  }

  const locked = Boolean(data.conductorRecord?.lockedAt);
  const conductorMech = data.todayDayConfig?.conductorMechanism;
  const vipMech = data.todayDayConfig?.vipMechanism;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#e6edf3]">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </div>
        {data.schedule ? (
          <div className="rounded-xl border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3]">
            {t("templateBadge", { template: data.schedule.templateType })}
          </div>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {data.dayConfigs.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-medium text-[#8b949e]">
            {t("weekSchedule")}
          </h2>
          <WeekScheduleStrip
            today={data.today}
            dayConfigs={data.dayConfigs}
            conductorLabels={conductorShortLabels}
            vipLabels={vipShortLabels}
          />
        </section>
      ) : data.canManageTrains ? (
        <section className="rounded-xl border border-dashed border-[#30363d] bg-[#161b22]/50 px-4 py-3 text-sm text-[#8b949e]">
          {t("noScheduleYet")}
        </section>
      ) : null}

      <TodayConductorCard
        record={data.conductorRecord}
        stats={data.conductorStats}
        labels={{
          awaiting: t("awaitingConductor"),
          conductor: t("todayConductor"),
          vip: t("todayVip"),
          locked: t("locked"),
          unlocked: t("unlocked"),
          lastConducted: t("lastConducted"),
          conductsThisYear: t("conductsThisYear"),
          noneYet: t("noneYet"),
        }}
      />

      {data.canManageTrains ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-[#30363d] bg-[#161b22] p-4">
          <h2 className="text-sm font-medium text-[#8b949e]">{t("quickActions")}</h2>
          <div className="flex flex-wrap gap-2">
            {canSpinConductor(conductorMech, locked) ? (
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void runRoll("conductor")}
                className="rounded-lg bg-[#8957e5] px-4 py-2 text-sm font-medium text-white hover:bg-[#9d6ff0] disabled:opacity-50"
              >
                {busy === "conductor" ? t("spinning") : t("spinWheel")}
              </button>
            ) : null}
            {conductorMech === "vs_high_score" || conductorMech === "donations_top" ? (
              <button
                type="button"
                disabled={busy != null || locked}
                onClick={() => void runRoll("conductor")}
                className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50"
              >
                {t("pickTopScorer")}
              </button>
            ) : null}
            {canSpinVip(vipMech, locked) ? (
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void runRoll("vip")}
                className="rounded-lg bg-[#bf8700] px-4 py-2 text-sm font-medium text-white hover:bg-[#d29922] disabled:opacity-50"
              >
                {t("spinVipWheel")}
              </button>
            ) : null}
            {!locked && data.conductorRecord?.conductorMemberId ? (
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void lockConductor()}
                className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50"
              >
                {busy === "lock" ? t("locking") : t("lockConductor")}
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[#30363d] pt-3">
            <span className="w-full text-xs text-[#8b949e]">{t("changeSchedule")}</span>
            {TEMPLATE_OPTIONS.map((template) => (
              <button
                key={template}
                type="button"
                disabled={busy != null}
                onClick={() => void changeTemplate(template)}
                className="rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#e6edf3] hover:bg-[#0d1117] disabled:opacity-50"
              >
                {t(`templates.${template}`)}
              </button>
            ))}
          </div>

          {conductorMech === "r3_lottery" || conductorMech === "r4_sequence" ? (
            <button
              type="button"
              disabled={busy != null}
              onClick={() =>
                void reseedPool(conductorMech === "r3_lottery" ? "r3" : "r4_plus")
              }
              className="self-start rounded-md border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e] hover:text-[#e6edf3] disabled:opacity-50"
            >
              {t("reseedPool")}
            </button>
          ) : null}
        </section>
      ) : null}

      <ConductorWheelModal
        open={wheelOpen}
        candidates={wheelCandidates}
        winner={wheelWinner}
        stats={wheelStats ?? null}
        onClose={() => setWheelOpen(false)}
      />
    </div>
  );
}
