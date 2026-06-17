"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

// ─── Types ──────────────────────────────────────────────────────────────────

type ArmStats = {
  id: string;
  name: string;
  isControl: boolean;
  configId: string | null;
  trafficWeight: number;
  config: { name: string; passKey: string } | null;
  jobCount: number;
  ratedCount: number;
  thumbsUpCount: number;
  avgQualityScore: number | null;
  qualityBuckets: Record<string, number>;
};

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  hypothesis: string | null;
  scoreTarget: string;
  boardKey: string | null;
  status: string;
  trafficPercent: number;
  startedAt: string | null;
  concludedAt: string | null;
  conclusion: string | null;
};

type DailyPoint = {
  date: string;
  armId: string;
  rated: number;
  thumbsUp: number;
};

type PopulationRow = {
  scoreTarget: string;
  boardKey: string | null;
  hqEventId: string | null;
  count: number;
};

type DetailResponse = {
  campaign: Campaign;
  arms: ArmStats[];
  dailySeries: DailyPoint[];
  population: PopulationRow[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-[#21262d] text-[#8b949e] border-[#30363d]",
  active: "bg-[#3fb95020] text-[#3fb950] border-[#3fb950]",
  paused: "bg-[#d2992220] text-[#d29922] border-[#d29922]",
  concluded: "bg-[#21262d] text-[#484f58] border-[#21262d]",
};

const ARM_COLORS = [
  "#58a6ff", // blue — usually control
  "#3fb950", // green
  "#d29922", // amber
  "#a371f7", // purple
  "#ff7b72", // red
];

function pct(n: number | null | undefined, d: number | null | undefined): string {
  if (!d || d === 0 || n == null) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function delta(armRate: number | null, controlRate: number | null): string {
  if (armRate == null || controlRate == null) return "—";
  const d = (armRate - controlRate) * 100;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}pp`;
}

function deltaColor(armRate: number | null, controlRate: number | null): string {
  if (armRate == null || controlRate == null) return "text-[#8b949e]";
  return armRate >= controlRate ? "text-[#3fb950]" : "text-[#f85149]";
}

const BUCKET_ORDER = ["perfect", "q1", "q2", "q3", "q4", "q5", "dropped_the_ball"];
const BUCKET_COLORS: Record<string, string> = {
  perfect: "text-[#3fb950]",
  q1: "text-[#3fb950]",
  q2: "text-[#d29922]",
  q3: "text-[#d29922]",
  q4: "text-[#f85149]",
  q5: "text-[#f85149]",
  dropped_the_ball: "text-[#f85149]",
};

// ─── SVG Timeline ────────────────────────────────────────────────────────────

function TimelineChart({
  series,
  arms,
  startedAt,
}: {
  series: DailyPoint[];
  arms: ArmStats[];
  startedAt: string | null;
}) {
  const t = useTranslations("admin.experimentsPage");

  const armIds = arms.map((a) => a.id);
  const W = 640;
  const H = 160;
  const PAD = { top: 12, right: 16, bottom: 28, left: 36 };

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  // Group by date × arm, compute rolling thumbs-up %
  type DayKey = string; // YYYY-MM-DD
  const byArmDay = useMemo(() => {
    const map = new Map<string, { rated: number; thumbsUp: number }>();
    for (const pt of series) {
      const key = `${pt.armId}::${pt.date}`;
      const existing = map.get(key) ?? { rated: 0, thumbsUp: 0 };
      map.set(key, {
        rated: existing.rated + pt.rated,
        thumbsUp: existing.thumbsUp + pt.thumbsUp,
      });
    }
    return map;
  }, [series]);

  const allDates = useMemo(() => {
    const dates = new Set<DayKey>();
    for (const pt of series) dates.add(pt.date);
    return Array.from(dates).sort();
  }, [series]);

  if (allDates.length < 2) {
    return (
      <p className="text-xs text-[#8b949e] py-4 text-center">{t("chart.noData")}</p>
    );
  }

  const xScale = (i: number) => PAD.left + (i / (allDates.length - 1)) * chartW;
  const yScale = (v: number) => PAD.top + chartH - v * chartH;

  // Build polyline points per arm
  const armLines = armIds.map((armId, armIdx) => {
    const points = allDates
      .map((date, i) => {
        const key = `${armId}::${date}`;
        const d = byArmDay.get(key);
        if (!d || d.rated === 0) return null;
        const rate = d.thumbsUp / d.rated;
        return `${xScale(i).toFixed(1)},${yScale(rate).toFixed(1)}`;
      })
      .filter(Boolean);
    return { armId, points, color: ARM_COLORS[armIdx % ARM_COLORS.length] };
  });

  // Start marker x position
  const startX =
    startedAt && allDates.length > 0
      ? (() => {
          const startDate = startedAt.slice(0, 10);
          const idx = allDates.findIndex((d) => d >= startDate);
          return idx >= 0 ? xScale(idx) : null;
        })()
      : null;

  // Y axis ticks: 0%, 50%, 100%
  const yTicks = [0, 0.5, 1];

  // X axis: show first, middle, last dates
  const xLabels = [
    { i: 0, date: allDates[0] },
    { i: Math.floor((allDates.length - 1) / 2), date: allDates[Math.floor((allDates.length - 1) / 2)] },
    { i: allDates.length - 1, date: allDates[allDates.length - 1] },
  ];

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-2xl"
        aria-label={t("chart.title")}
      >
        {/* Grid lines */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={PAD.left + chartW}
              y1={yScale(v)}
              y2={yScale(v)}
              stroke="#30363d"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 4}
              y={yScale(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="9"
              fill="#8b949e"
            >
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}

        {/* Start marker */}
        {startX !== null && (
          <>
            <line
              x1={startX}
              x2={startX}
              y1={PAD.top}
              y2={PAD.top + chartH}
              stroke="#58a6ff"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            <text
              x={startX + 3}
              y={PAD.top + 8}
              fontSize="8"
              fill="#58a6ff"
            >
              {t("chart.started")}
            </text>
          </>
        )}

        {/* Arm lines */}
        {armLines.map(({ armId, points, color }) =>
          points.length > 1 ? (
            <polyline
              key={armId}
              points={points.join(" ")}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}

        {/* X axis labels */}
        {xLabels.map(({ i, date }) => (
          <text
            key={date}
            x={xScale(i)}
            y={H - PAD.bottom + 12}
            textAnchor="middle"
            fontSize="8"
            fill="#8b949e"
          >
            {date.slice(5)}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-4">
        {arms.map((arm, idx) => (
          <div key={arm.id} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-6 rounded-full"
              style={{ backgroundColor: ARM_COLORS[idx % ARM_COLORS.length] }}
            />
            <span className="text-xs text-[#8b949e]">
              {arm.name}
              {arm.isControl ? " (control)" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function AdminExperimentDetailView({ campaignId }: { campaignId: string }) {
  const t = useTranslations("admin.experimentsPage");
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Status transition
  const [transitioning, setTransitioning] = useState(false);
  const [concludeText, setConcludeText] = useState("");
  const [showConcludeForm, setShowConcludeForm] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Add arm form
  const [showArmForm, setShowArmForm] = useState(false);
  const [armForm, setArmForm] = useState({ name: "", isControl: false, configId: "", trafficWeight: "50" });
  const [armError, setArmError] = useState<string | null>(null);
  const [savingArm, setSavingArm] = useState(false);

  // Parse config picker for arm form
  const [availableConfigs, setAvailableConfigs] = useState<{ id: string; name: string; passKey: string }[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);

  // Promote state — promoteConfigId holds the configId of the arm being promoted
  const [promoteConfigId, setPromoteConfigId] = useState("");
  const [promoteNotes, setPromoteNotes] = useState("");
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoted, setPromoted] = useState(false);

  // Load available parse configs when the arm form is opened.
  // Defined as a useCallback so the effect body does not call setState directly.
  const loadAvailableConfigs = useCallback(async () => {
    if (availableConfigs.length > 0) return;
    setLoadingConfigs(true);
    try {
      const res = await fetch("/api/admin/parse-configs?status=active");
      if (res.ok) {
        const d = (await res.json()) as { configs: { id: string; name: string; passKey: string }[] };
        setAvailableConfigs(d.configs);
      }
    } finally {
      setLoadingConfigs(false);
    }
  }, [availableConfigs.length]);

  useEffect(() => {
    if (!showArmForm) return;
    void (async () => {
      try {
        await loadAvailableConfigs();
      } catch {
        // silently skip — arm form degrades to no options
      }
    })();
  }, [showArmForm, loadAvailableConfigs]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/experiments/${campaignId}`);
      if (!res.ok) throw new Error(await res.text());
      setData((await res.json()) as DetailResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [campaignId, t]);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch {
        // handled inside load
      }
    })();
  }, [load]);

  async function transition(status: string, extra: Record<string, unknown> = {}) {
    setTransitioning(true);
    setTransitionError(null);
    try {
      const res = await fetch(`/api/admin/experiments/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      });
      if (!res.ok) throw new Error(await res.text());
      setShowConcludeForm(false);
      setConcludeText("");
      await load();
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setTransitioning(false);
    }
  }

  async function addArm(e: React.FormEvent) {
    e.preventDefault();
    setSavingArm(true);
    setArmError(null);
    try {
      const res = await fetch(`/api/admin/experiments/${campaignId}/arms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: armForm.name,
          isControl: armForm.isControl,
          configId: armForm.configId || null,
          trafficWeight: parseInt(armForm.trafficWeight, 10) || 50,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setArmForm({ name: "", isControl: false, configId: "", trafficWeight: "50" });
      setShowArmForm(false);
      await load();
    } catch (err) {
      setArmError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSavingArm(false);
    }
  }

  async function promoteArm(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setPromoting(true);
    setPromoteError(null);
    try {
      const res = await fetch("/api/admin/config-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scoreTarget: data.campaign.scoreTarget,
          boardKey: data.campaign.boardKey ?? null,
          configId: promoteConfigId,
          notes: promoteNotes || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPromoted(true);
    } catch (err) {
      setPromoteError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setPromoting(false);
    }
  }

  if (loading) return <p className="text-sm text-[#8b949e]">{t("loading")}</p>;
  if (error) return <p className="text-sm text-[#f85149]">{error}</p>;
  if (!data) return null;

  const { campaign, arms, dailySeries, population } = data;
  const statusCls = STATUS_COLORS[campaign.status] ?? STATUS_COLORS.draft;
  const controlArm = arms.find((a) => a.isControl);

  // Distinct scoreTargets in population
  const popScoreTargets = new Set(population.map((p) => p.scoreTarget));
  const mixedPopulation = popScoreTargets.size > 1;

  // Low-sample arms for conclude warning (threshold: 30 rated per arm)
  const LOW_SAMPLE_THRESHOLD = 30;
  const lowSampleArms = arms.filter((a) => a.ratedCount < LOW_SAMPLE_THRESHOLD);

  // Variant arms eligible to promote (non-control, has a config)
  const promotableArms = arms.filter((a) => !a.isControl && a.configId);

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link href="/admin/experiments" className="text-xs text-[#8b949e] hover:text-[#58a6ff] transition-colors">
        ← {t("backToList")}
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-[#e6edf3]">{campaign.name}</h1>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusCls}`}>
              {campaign.status}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-[#8b949e]">
            <span className="font-mono text-[#79c0ff]">
              {campaign.scoreTarget}
              {campaign.boardKey ? ` · ${campaign.boardKey}` : ""}
            </span>
            <span>{campaign.trafficPercent}% traffic</span>
            {campaign.startedAt && (
              <span>{t("started")} {new Date(campaign.startedAt).toLocaleDateString()}</span>
            )}
            {campaign.concludedAt && (
              <span>{t("concluded")} {new Date(campaign.concludedAt).toLocaleDateString()}</span>
            )}
          </div>
          {campaign.hypothesis && (
            <p className="mt-2 text-sm text-[#8b949e] italic">{campaign.hypothesis}</p>
          )}
        </div>

        {/* Status controls */}
        <div className="flex flex-wrap gap-2">
          {campaign.status === "draft" && (
            <button
              onClick={() => void transition("active")}
              disabled={transitioning}
              className="rounded-md bg-[#238636] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
            >
              {t("startCampaign")}
            </button>
          )}
          {campaign.status === "active" && (
            <>
              <button
                onClick={() => void transition("paused")}
                disabled={transitioning}
                className="rounded-md border border-[#d29922] px-3 py-1.5 text-sm text-[#d29922] hover:bg-[#d2992215] disabled:opacity-50 transition-colors"
              >
                {t("pause")}
              </button>
              <button
                onClick={() => setShowConcludeForm(true)}
                className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff] transition-colors"
              >
                {t("conclude")}
              </button>
            </>
          )}
          {campaign.status === "paused" && (
            <>
              <button
                onClick={() => void transition("active")}
                disabled={transitioning}
                className="rounded-md bg-[#238636] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
              >
                {t("resume")}
              </button>
              <button
                onClick={() => setShowConcludeForm(true)}
                className="rounded-md border border-[#30363d] px-3 py-1.5 text-sm text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff] transition-colors"
              >
                {t("conclude")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Conclude form */}
      {showConcludeForm && (
        <div className="rounded-lg border border-[#d29922] bg-[#d2992208] p-4 space-y-3">
          <h3 className="text-sm font-semibold text-[#d29922]">{t("concludeTitle")}</h3>
          <p className="text-xs text-[#8b949e]">{t("concludeHint")}</p>
          {lowSampleArms.length > 0 && (
            <div className="space-y-1">
              {lowSampleArms.map((arm) => (
                <div
                  key={arm.id}
                  className="rounded border border-[#d2992260] bg-[#d2992210] px-3 py-2 text-xs text-[#d29922]"
                >
                  ⚠ {arm.name}: {t("lowSampleWarning", { count: arm.ratedCount })}
                </div>
              ))}
            </div>
          )}
          <textarea
            rows={3}
            placeholder={t("conclusionPlaceholder")}
            value={concludeText}
            onChange={(e) => setConcludeText(e.target.value)}
            className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
          />
          {transitionError && <p className="text-xs text-[#f85149]">{transitionError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void transition("concluded", { conclusion: concludeText })}
              disabled={!concludeText.trim() || transitioning}
              className="rounded-md bg-[#d29922] px-4 py-1.5 text-sm font-medium text-[#0d1117] hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {transitioning ? t("saving") : t("confirmConclude")}
            </button>
            <button
              onClick={() => setShowConcludeForm(false)}
              className="rounded-md border border-[#30363d] px-4 py-1.5 text-sm text-[#8b949e] hover:text-[#e6edf3] transition-colors"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {transitionError && !showConcludeForm && (
        <p className="text-sm text-[#f85149]">{transitionError}</p>
      )}

      {/* Concluded outcome */}
      {campaign.conclusion && (
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#8b949e]">{t("outcome")}</h3>
          <p className="mt-2 text-sm text-[#e6edf3]">{campaign.conclusion}</p>
        </div>
      )}

      {/* Population panel */}
      <section className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[#e6edf3]">{t("population.title")}</h2>
        <p className="text-xs text-[#8b949e]">{t("population.hint")}</p>

        {mixedPopulation && (
          <div className="rounded border border-[#f85149] bg-[#f8514910] px-3 py-2 text-xs text-[#f85149]">
            ⚠ {t("population.mixedWarning")}
          </div>
        )}

        {population.length === 0 ? (
          <p className="text-xs text-[#8b949e]">{t("population.noData")}</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#21262d] text-[#8b949e]">
                <th className="pb-1 text-left">{t("population.col.scoreTarget")}</th>
                <th className="pb-1 text-left">{t("population.col.boardKey")}</th>
                <th className="pb-1 text-left">{t("population.col.hqEvent")}</th>
                <th className="pb-1 text-right">{t("population.col.jobs")}</th>
              </tr>
            </thead>
            <tbody>
              {population.map((row, i) => (
                <tr key={i} className="border-b border-[#21262d]">
                  <td className="py-1 font-mono text-[#79c0ff]">{row.scoreTarget}</td>
                  <td className="py-1 text-[#8b949e]">{row.boardKey ?? "—"}</td>
                  <td className="py-1 text-[#8b949e]">{row.hqEventId ?? "—"}</td>
                  <td className="py-1 text-right text-[#e6edf3]">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Arms */}
      <section className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#e6edf3]">{t("arms.title")}</h2>
          {campaign.status === "draft" && (
            <button
              onClick={() => setShowArmForm((v) => !v)}
              className="rounded border border-[#30363d] px-2 py-1 text-xs text-[#8b949e] hover:border-[#58a6ff] hover:text-[#58a6ff] transition-colors"
            >
              {showArmForm ? t("cancel") : t("arms.add")}
            </button>
          )}
        </div>

        {showArmForm && (
          <form onSubmit={(e) => void addArm(e)} className="grid grid-cols-2 gap-3 rounded border border-[#30363d] p-3 sm:grid-cols-4">
            <label className="block">
              <span className="text-xs text-[#8b949e]">{t("arms.form.name")}</span>
              <input
                required
                value={armForm.name}
                onChange={(e) => setArmForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs text-[#8b949e]">{t("arms.configPickerLabel")}</span>
              {loadingConfigs ? (
                <p className="mt-1 text-xs text-[#484f58]">{t("arms.loadConfigs")}</p>
              ) : (
                <select
                  value={armForm.configId}
                  onChange={(e) => setArmForm((f) => ({ ...f, configId: e.target.value }))}
                  className="mt-1 w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
                >
                  <option value="">{t("arms.configDefault")}</option>
                  {availableConfigs.map((cfg) => (
                    <option key={cfg.id} value={cfg.id}>
                      {cfg.name} ({cfg.passKey})
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block">
              <span className="text-xs text-[#8b949e]">{t("arms.form.weight")}</span>
              <input
                type="number"
                min="1"
                value={armForm.trafficWeight}
                onChange={(e) => setArmForm((f) => ({ ...f, trafficWeight: e.target.value }))}
                className="mt-1 w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
              />
            </label>
            <label className="flex items-end gap-2 pb-1">
              <input
                type="checkbox"
                checked={armForm.isControl}
                onChange={(e) => setArmForm((f) => ({ ...f, isControl: e.target.checked }))}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs text-[#8b949e]">{t("arms.form.isControl")}</span>
            </label>
            {armError && <p className="col-span-4 text-xs text-[#f85149]">{armError}</p>}
            <button
              type="submit"
              disabled={savingArm}
              className="col-span-4 rounded-md bg-[#238636] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
            >
              {savingArm ? t("saving") : t("arms.form.save")}
            </button>
          </form>
        )}

        {/* Arm comparison table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#30363d] text-[#8b949e] uppercase tracking-wide">
                <th className="pb-2 text-left">{t("arms.col.name")}</th>
                <th className="pb-2 text-left">{t("arms.col.config")}</th>
                <th className="pb-2 text-right">{t("arms.col.weight")}</th>
                <th className="pb-2 text-right">{t("arms.col.jobs")}</th>
                <th className="pb-2 text-right">{t("arms.col.rated")}</th>
                <th className="pb-2 text-right">{t("arms.col.thumbsUp")}</th>
                <th className="pb-2 text-right">{t("arms.col.avgQuality")}</th>
                <th className="pb-2 text-right">{t("arms.col.delta")}</th>
                <th className="pb-2 text-left">{t("arms.col.buckets")}</th>
              </tr>
            </thead>
            <tbody>
              {arms.map((arm, idx) => {
                const armRate = arm.ratedCount > 0 ? arm.thumbsUpCount / arm.ratedCount : null;
                const ctrlRate = controlArm && controlArm.ratedCount > 0
                  ? controlArm.thumbsUpCount / controlArm.ratedCount
                  : null;
                const isCtrl = arm.isControl;
                const color = ARM_COLORS[idx % ARM_COLORS.length];

                return (
                  <tr key={arm.id} className="border-b border-[#21262d]">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="text-[#e6edf3]">{arm.name}</span>
                        {isCtrl && (
                          <span className="rounded bg-[#58a6ff20] px-1 text-[10px] text-[#58a6ff]">
                            control
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2">
                      {arm.config ? (
                        <span className="font-mono text-[#79c0ff]">{arm.config.passKey}</span>
                      ) : (
                        <span className="text-[#484f58]">default</span>
                      )}
                    </td>
                    <td className="py-2 text-right text-[#8b949e]">{arm.trafficWeight}</td>
                    <td className="py-2 text-right text-[#e6edf3]">{arm.jobCount}</td>
                    <td className="py-2 text-right text-[#8b949e]">{arm.ratedCount}</td>
                    <td className="py-2 text-right text-[#e6edf3]">
                      {pct(arm.thumbsUpCount, arm.ratedCount)}
                    </td>
                    <td className="py-2 text-right text-[#8b949e]">
                      {arm.avgQualityScore != null ? arm.avgQualityScore.toFixed(2) : "—"}
                    </td>
                    <td className={`py-2 text-right font-medium ${isCtrl ? "text-[#8b949e]" : deltaColor(armRate, ctrlRate)}`}>
                      {isCtrl ? "—" : delta(armRate, ctrlRate)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {BUCKET_ORDER.filter((b) => arm.qualityBuckets[b]).map((b) => (
                          <span key={b} className={`text-[10px] ${BUCKET_COLORS[b]}`}>
                            {b}:{arm.qualityBuckets[b]}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {arms.length > 0 && controlArm && (
          <p className="text-xs text-[#8b949e]">
            {t("arms.deltaNote")}
          </p>
        )}
      </section>

      {/* Timeline chart */}
      {dailySeries.length > 0 && (
        <section className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[#e6edf3]">{t("chart.title")}</h2>
          <p className="text-xs text-[#8b949e]">{t("chart.hint")}</p>
          <TimelineChart
            series={dailySeries}
            arms={arms}
            startedAt={campaign.startedAt}
          />
        </section>
      )}

      {/* Promote winner */}
      {campaign.status === "concluded" && (
        <section className="rounded-lg border border-[#30363d] bg-[#161b22] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-[#e6edf3]">{t("promote.title")}</h2>
          <p className="text-xs text-[#8b949e]">{t("promote.hint")}</p>

          {promoted ? (
            <div className="rounded border border-[#3fb950] bg-[#3fb95010] px-3 py-3 space-y-1">
              <p className="text-sm font-medium text-[#3fb950]">✓ {t("promote.successTitle")}</p>
              <p className="text-xs text-[#8b949e]">{t("promote.successHint")}</p>
            </div>
          ) : promotableArms.length === 0 ? (
            <p className="text-xs text-[#484f58]">{t("promote.noVariantArms")}</p>
          ) : (
            <form onSubmit={(e) => void promoteArm(e)} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-[#8b949e]">{t("promote.selectArm")}</span>
                <select
                  required
                  value={promoteConfigId}
                  onChange={(e) => setPromoteConfigId(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
                >
                  <option value="">—</option>
                  {promotableArms.map((arm) => {
                    const armRate = arm.ratedCount > 0 ? ((arm.thumbsUpCount / arm.ratedCount) * 100).toFixed(1) : null;
                    return (
                      <option key={arm.id} value={arm.configId!}>
                        {arm.name} — {arm.config?.passKey ?? arm.configId}
                        {armRate !== null ? ` (${armRate}% 👍, ${arm.ratedCount} rated)` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[#8b949e]">{t("promote.notes")}</span>
                <input
                  placeholder={t("promote.notesPlaceholder")}
                  value={promoteNotes}
                  onChange={(e) => setPromoteNotes(e.target.value)}
                  className="w-full rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-sm text-[#e6edf3] focus:border-[#58a6ff] focus:outline-none"
                />
              </label>
              {promoteError && (
                <p className="text-xs text-[#f85149]">{promoteError}</p>
              )}
              <button
                type="submit"
                disabled={!promoteConfigId || promoting}
                className="rounded-md bg-[#238636] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50 transition-colors"
              >
                {promoting ? t("saving") : t("promote.confirmCta")}
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
