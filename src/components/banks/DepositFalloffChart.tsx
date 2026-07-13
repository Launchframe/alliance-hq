"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, X } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { analyticsTooltipProps } from "@/components/analytics/AnalyticsChartTooltip";
import { Dialog } from "@/components/ui/dialog";
import {
  buildDepositFalloffSeries,
  summarizeProjectionVsActual,
} from "@/lib/banks/optimization.shared";
import {
  FALLOFF_HORIZON_HOURS_OPTIONS,
  DEFAULT_FALLOFF_HORIZON_HOURS,
  DEFAULT_FALLOFF_STEP_HOURS,
  type BankWithSlips,
  type DepositFalloffLiveResponse,
  type DepositFalloffScope,
  type DepositProjectionCreateResponse,
  type DepositProjectionDetailResponse,
  type DepositProjectionListResponse,
  type FalloffHorizonHours,
  type FalloffPoint,
  type ProjectionVsActualSummary,
  type SerializedDepositProjection,
} from "@/lib/banks/types.shared";
import {
  preventDefaultFormSubmit,
  FORM_SUBMIT_ENTER_KEY_HINT,
} from "@/lib/client/form-enter-submit.shared";
import { formatBrowserLocalDateTime } from "@/lib/timezone/format";

const PROJECTED_LOCKED_COLOR = "#58a6ff";
const MATURING_OUTFLOW_COLOR = "#ffa657";
const ACTUAL_LOCKED_COLOR = "#3fb950";
const DROP_BY_COLOR = "#f85149";
const RECOMMENDED_COLOR = "#d29922";

type Props = {
  /** Currently selected bank — drives bank-scope fetch, dropByAt marker, and local fallback data. */
  bank: BankWithSlips | null;
  /** All held banks — used for the alliance-scope local fallback aggregate while the live API is unavailable. */
  banks: readonly BankWithSlips[];
  /** Recommended-drop reference marker for the selected bank, if the recommendation targets it. */
  recommendedDropAtIso?: string | null;
  canWrite: boolean;
};

type ChartRow = {
  hourStartIso: string;
  label: string;
  lockedValue: number | null;
  maturingValue: number | null;
  actualLockedValue?: number | null;
};

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString();
}

function formatHourLabel(iso: string): string {
  return formatBrowserLocalDateTime(iso, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatSavedAt(iso: string): string {
  return formatBrowserLocalDateTime(iso, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function nearestHourStartIso(
  points: readonly FalloffPoint[],
  targetIso: string | null | undefined,
): string | null {
  if (!targetIso) return null;
  const targetMs = new Date(targetIso).getTime();
  if (Number.isNaN(targetMs)) return null;
  let best: FalloffPoint | null = null;
  let bestDiff = Infinity;
  for (const point of points) {
    const diff = Math.abs(new Date(point.hourStartIso).getTime() - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = point;
    }
  }
  // Only snap to a marker if it falls within the visible horizon (~1 bucket of slack).
  return best && bestDiff <= 2 * 60 * 60 * 1000 ? best.hourStartIso : null;
}

function buildChartRows(
  projected: readonly FalloffPoint[],
  actual: readonly FalloffPoint[] | null,
): ChartRow[] {
  const actualByHour = new Map((actual ?? []).map((point) => [point.hourStartIso, point]));
  return projected.map((point) => ({
    hourStartIso: point.hourStartIso,
    label: formatHourLabel(point.hourStartIso),
    lockedValue: point.lockedValue,
    maturingValue: point.maturingValue,
    actualLockedValue: actualByHour.get(point.hourStartIso)?.lockedValue ?? null,
  }));
}

export function DepositFalloffChart({
  bank,
  banks,
  recommendedDropAtIso,
  canWrite,
}: Props) {
  const t = useTranslations("bankManagement");

  const [scope, setScope] = useState<DepositFalloffScope>(bank ? "bank" : "alliance");
  const [horizonHours, setHorizonHours] = useState<FalloffHorizonHours>(
    DEFAULT_FALLOFF_HORIZON_HOURS,
  );

  const [livePoints, setLivePoints] = useState<FalloffPoint[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveIsFallback, setLiveIsFallback] = useState(false);

  const [projections, setProjections] = useState<SerializedDepositProjection[]>([]);
  const [projectionsError, setProjectionsError] = useState<string | null>(null);

  const [selectedProjectionId, setSelectedProjectionId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<DepositProjectionDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // A bank-scope selection only makes sense while a bank is actually selected;
  // fall back to the alliance rollup instead of syncing scope via an effect.
  const effectiveScope: DepositFalloffScope = bank ? scope : "alliance";

  // Reset the saved-projection selection whenever the underlying series
  // changes shape (scope or bank switch) — computed during render per React's
  // "adjusting state when a prop changes" pattern, so no effect is needed.
  const scopeBankKey = `${effectiveScope}:${bank?.id ?? ""}`;
  const [lastScopeBankKey, setLastScopeBankKey] = useState(scopeBankKey);
  if (scopeBankKey !== lastScopeBankKey) {
    setLastScopeBankKey(scopeBankKey);
    setSelectedProjectionId(null);
  }

  const buildLocalFallback = useCallback((): FalloffPoint[] => {
    const slips =
      effectiveScope === "bank" && bank
        ? bank.depositSlips
        : banks.flatMap((row) => row.depositSlips);
    return buildDepositFalloffSeries(slips, {
      hours: horizonHours,
      stepHours: DEFAULT_FALLOFF_STEP_HOURS,
    });
  }, [bank, banks, effectiveScope, horizonHours]);

  const fetchLive = useCallback(async () => {
    if (effectiveScope === "bank" && !bank) return;
    setLiveLoading(true);
    try {
      const url =
        effectiveScope === "bank"
          ? `/api/banks/${bank!.id}/deposit-falloff?horizonHours=${horizonHours}`
          : `/api/banks/deposit-falloff?horizonHours=${horizonHours}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = (await response.json()) as DepositFalloffLiveResponse;
      setLivePoints(data.points);
      setLiveIsFallback(false);
    } catch {
      // Live falloff API not available yet (or request failed) — fall back to
      // computing the same pure projection locally from data already on hand.
      setLivePoints(buildLocalFallback());
      setLiveIsFallback(true);
    } finally {
      setLiveLoading(false);
    }
  }, [bank, buildLocalFallback, effectiveScope, horizonHours]);

  const fetchProjections = useCallback(async () => {
    setProjectionsError(null);
    try {
      const params = new URLSearchParams({ scope: effectiveScope });
      if (effectiveScope === "bank" && bank) params.set("bankId", bank.id);
      const response = await fetch(`/api/banks/deposit-projections?${params.toString()}`);
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = (await response.json()) as DepositProjectionListResponse;
      const filtered = data.projections.filter((projection) =>
        effectiveScope === "bank"
          ? projection.bankId === bank?.id
          : projection.scope === "alliance",
      );
      setProjections(filtered);
    } catch {
      setProjections([]);
      setProjectionsError(t("falloff.historyLoadError"));
    }
  }, [bank, effectiveScope, t]);

  useEffect(() => {
    void (async () => {
      await fetchLive();
    })();
  }, [fetchLive]);

  useEffect(() => {
    void (async () => {
      await fetchProjections();
    })();
  }, [fetchProjections]);

  useEffect(() => {
    if (!selectedProjectionId) return;
    let cancelled = false;
    void (async () => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await fetch(
          `/api/banks/deposit-projections/${selectedProjectionId}`,
        );
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = (await response.json()) as DepositProjectionDetailResponse;
        if (!cancelled) setSelectedDetail(data);
      } catch {
        if (!cancelled) setDetailError(t("falloff.detailLoadError"));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectionId, t]);

  // Only trust `selectedDetail` while it matches the current selection — this
  // avoids needing a separate effect to null it out when the selection clears.
  const activeDetail =
    selectedDetail && selectedDetail.projection.id === selectedProjectionId
      ? selectedDetail
      : null;

  const activeProjectedPoints = activeDetail ? activeDetail.projection.points : livePoints;
  const activeActualPoints = activeDetail ? activeDetail.actualPoints : null;
  const deltas: ProjectionVsActualSummary | null = activeDetail
    ? activeDetail.deltas ??
      summarizeProjectionVsActual(activeDetail.projection.points, activeDetail.actualPoints)
    : null;

  const chartRows = useMemo(
    () => buildChartRows(activeProjectedPoints, activeActualPoints),
    [activeActualPoints, activeProjectedPoints],
  );

  const dropByMarkerHour = useMemo(
    () =>
      effectiveScope === "bank" && bank?.dropByAt
        ? nearestHourStartIso(activeProjectedPoints, bank.dropByAt)
        : null,
    [activeProjectedPoints, bank, effectiveScope],
  );
  const recommendedMarkerHour = useMemo(
    () =>
      effectiveScope === "bank" && recommendedDropAtIso
        ? nearestHourStartIso(activeProjectedPoints, recommendedDropAtIso)
        : null,
    [activeProjectedPoints, recommendedDropAtIso, effectiveScope],
  );

  const openSaveDialog = () => {
    setSaveName("");
    setSaveNotes("");
    setSaveError(null);
    setSaveDialogOpen(true);
  };

  const submitSaveProjection = async () => {
    if (!saveName.trim()) {
      setSaveError(t("falloff.nameRequired"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/banks/deposit-projections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankId: effectiveScope === "bank" ? bank?.id ?? null : null,
          scope: effectiveScope,
          name: saveName.trim(),
          notes: saveNotes.trim() || null,
          horizonHours,
          stepHours: DEFAULT_FALLOFF_STEP_HOURS,
          points: livePoints,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setSaveError(data?.error ?? t("errors.falloffSaveFailed"));
        return;
      }
      const data = (await response.json()) as DepositProjectionCreateResponse;
      setSaveDialogOpen(false);
      await fetchProjections();
      setSelectedProjectionId(data.projection.id);
    } catch {
      setSaveError(t("errors.falloffSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const deleteProjection = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/banks/deposit-projections/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
      if (selectedProjectionId === id) setSelectedProjectionId(null);
      await fetchProjections();
    } finally {
      setDeletingId(null);
    }
  };

  const viewingSaved = activeDetail?.projection ?? null;

  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-hq-border bg-hq-surface p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-hq-fg">{t("falloff.title")}</h2>
          <p className="mt-1 text-xs text-hq-fg-muted">{t("falloff.hint")}</p>
        </div>
        {canWrite ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center rounded border border-hq-border px-3 py-1.5 text-xs font-medium text-hq-fg hover:border-hq-accent"
            onClick={openSaveDialog}
            disabled={livePoints.length === 0}
          >
            {t("falloff.save")}
          </button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-1 text-xs">
          <span className="text-hq-fg-muted">{t("falloff.horizon")}:</span>
          <div className="flex gap-1">
            {FALLOFF_HORIZON_HOURS_OPTIONS.map((hours) => (
              <button
                key={hours}
                type="button"
                className={`rounded border px-2 py-1 ${
                  horizonHours === hours
                    ? "border-hq-accent bg-hq-accent/10 text-hq-accent"
                    : "border-hq-border text-hq-fg-muted hover:text-hq-fg"
                }`}
                onClick={() => setHorizonHours(hours)}
              >
                {t("falloff.horizonOption", { hours })}
              </button>
            ))}
          </div>
        </div>

        {bank ? (
          <div className="flex min-w-0 items-center gap-1 text-xs">
            <span className="text-hq-fg-muted">{t("falloff.scope")}:</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={`rounded border px-2 py-1 ${
                  effectiveScope === "bank"
                    ? "border-hq-accent bg-hq-accent/10 text-hq-accent"
                    : "border-hq-border text-hq-fg-muted hover:text-hq-fg"
                }`}
                onClick={() => setScope("bank")}
              >
                {t("falloff.scopeBank")}
              </button>
              <button
                type="button"
                className={`rounded border px-2 py-1 ${
                  effectiveScope === "alliance"
                    ? "border-hq-accent bg-hq-accent/10 text-hq-accent"
                    : "border-hq-border text-hq-fg-muted hover:text-hq-fg"
                }`}
                onClick={() => setScope("alliance")}
              >
                {t("falloff.scopeAlliance")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {liveIsFallback ? (
        <p className="text-xs text-hq-fg-subtle">{t("falloff.localFallbackNotice")}</p>
      ) : null}

      {viewingSaved ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded border border-hq-accent/40 bg-hq-accent/5 px-3 py-2 text-xs">
          <span className="min-w-0 break-words text-hq-fg">
            {t("falloff.viewingSaved", { name: viewingSaved.name })}
          </span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-hq-border px-2 py-1 text-hq-fg-muted hover:text-hq-fg"
            onClick={() => setSelectedProjectionId(null)}
          >
            <X className="h-3 w-3" aria-hidden />
            {t("falloff.clearSelection")}
          </button>
        </div>
      ) : null}
      {detailError ? <p className="text-xs text-hq-danger">{detailError}</p> : null}

      <div className="h-72 w-full min-w-0">
        {liveLoading && chartRows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-hq-fg-muted">
            {t("falloff.loading")}
          </div>
        ) : chartRows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-hq-fg-muted">
            {t("falloff.liveEmpty")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <ComposedChart data={chartRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#30363d" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fill: "#8b949e", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "#8b949e", fontSize: 11 }}
                tickFormatter={(value) => formatAmount(Number(value))}
              />
              <Tooltip
                {...analyticsTooltipProps}
                formatter={(value, name) => [formatAmount(Number(value)), name]}
              />
              <Area
                type="monotone"
                dataKey="lockedValue"
                name={t("falloff.lockedValue")}
                stroke={PROJECTED_LOCKED_COLOR}
                fill={PROJECTED_LOCKED_COLOR}
                fillOpacity={0.18}
                strokeWidth={2}
              />
              <Bar
                dataKey="maturingValue"
                name={t("falloff.maturingValue")}
                fill={MATURING_OUTFLOW_COLOR}
                fillOpacity={0.7}
                barSize={6}
              />
              {activeActualPoints ? (
                <Line
                  type="monotone"
                  dataKey="actualLockedValue"
                  name={t("falloff.overlayActual")}
                  stroke={ACTUAL_LOCKED_COLOR}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls={false}
                />
              ) : null}
              {dropByMarkerHour ? (
                <ReferenceLine
                  x={formatHourLabel(dropByMarkerHour)}
                  stroke={DROP_BY_COLOR}
                  strokeDasharray="4 2"
                  label={{
                    value: t("falloff.dropByMarker"),
                    fill: DROP_BY_COLOR,
                    fontSize: 11,
                    position: "insideTopRight",
                  }}
                />
              ) : null}
              {recommendedMarkerHour ? (
                <ReferenceLine
                  x={formatHourLabel(recommendedMarkerHour)}
                  stroke={RECOMMENDED_COLOR}
                  strokeDasharray="4 2"
                  label={{
                    value: t("falloff.recommendedMarker"),
                    fill: RECOMMENDED_COLOR,
                    fontSize: 11,
                    position: "insideBottomRight",
                  }}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {deltas ? (
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <div className="min-w-0 rounded border border-hq-border bg-hq-canvas p-2">
            <div className="text-xs text-hq-fg-muted">{t("falloff.deltaFinal")}</div>
            <div className="text-sm font-semibold text-hq-fg">
              {formatAmount(deltas.finalDelta)}
            </div>
          </div>
          <div className="min-w-0 rounded border border-hq-border bg-hq-canvas p-2">
            <div className="text-xs text-hq-fg-muted">{t("falloff.deltaMaxPositive")}</div>
            <div className="text-sm font-semibold text-hq-fg">
              {formatAmount(deltas.maxPositiveError)}
            </div>
          </div>
          <div className="min-w-0 rounded border border-hq-border bg-hq-canvas p-2">
            <div className="text-xs text-hq-fg-muted">
              {t("falloff.deltaUnexpectedInflow")}
            </div>
            <div className="text-sm font-semibold text-hq-fg">
              {formatAmount(deltas.unexpectedInflow)}
            </div>
          </div>
          <div className="min-w-0 rounded border border-hq-border bg-hq-canvas p-2">
            <div className="text-xs text-hq-fg-muted">{t("falloff.deltaEarlyLoot")}</div>
            <div className="text-sm font-semibold text-hq-fg">
              {formatAmount(deltas.earlyLootValue)}
            </div>
          </div>
        </div>
      ) : null}
      {detailLoading ? (
        <p className="text-xs text-hq-fg-muted">{t("falloff.loading")}</p>
      ) : null}

      <div className="min-w-0 space-y-2">
        <h3 className="text-xs font-semibold text-hq-fg-muted">{t("falloff.history")}</h3>
        {projectionsError ? (
          <p className="text-xs text-hq-danger">{projectionsError}</p>
        ) : projections.length === 0 ? (
          <p className="text-xs text-hq-fg-muted">{t("falloff.historyEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {projections.map((projection) => {
              const selected = projection.id === selectedProjectionId;
              return (
                <li key={projection.id}>
                  <div
                    className={`flex items-center gap-2 rounded border p-2 text-xs ${
                      selected
                        ? "border-hq-accent bg-hq-accent/10"
                        : "border-hq-border bg-hq-canvas"
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() =>
                        setSelectedProjectionId(selected ? null : projection.id)
                      }
                    >
                      <div className="min-w-0 break-words font-medium text-hq-fg">
                        {projection.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-hq-fg-muted">
                        <span>{formatSavedAt(projection.createdAt)}</span>
                        <span>
                          {t("falloff.horizonOption", { hours: projection.horizonHours })}
                        </span>
                      </div>
                    </button>
                    {canWrite ? (
                      <button
                        type="button"
                        aria-label={t("falloff.deleteProjection")}
                        className="shrink-0 rounded border border-hq-border p-1.5 text-hq-fg-muted hover:border-hq-danger hover:text-hq-danger disabled:opacity-50"
                        disabled={deletingId === projection.id}
                        onClick={() => void deleteProjection(projection.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={saveDialogOpen}
        onOpenChange={(open) => {
          if (!open) setSaveDialogOpen(false);
        }}
        title={t("falloff.saveDialogTitle")}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void submitSaveProjection();
          }}
        >
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("falloff.saveDialogTitle")}
          </h2>
          {saveError ? (
            <div className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-3 py-2 text-sm text-hq-danger">
              {saveError}
            </div>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.projectionName")}</span>
            <input
              type="text"
              required
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-hq-fg-muted">{t("fields.projectionNotes")}</span>
            <textarea
              rows={3}
              className="w-full rounded border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              value={saveNotes}
              onChange={(event) => setSaveNotes(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
              onClick={() => setSaveDialogOpen(false)}
              disabled={saving}
            >
              {t("actions.cancel")}
            </button>
            <button
              type="submit"
              className="rounded border border-hq-success bg-hq-success px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={saving}
              title={FORM_SUBMIT_ENTER_KEY_HINT}
            >
              {saving ? t("actions.saving") : t("actions.save")}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
