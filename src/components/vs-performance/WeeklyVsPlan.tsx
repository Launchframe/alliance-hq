"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";

import {
  VS_DAY_POINTS,
  VS_PLATFORMS,
  buildVsPlatformDraft,
  vsPlanDraftSchema,
  vsPlannedPushPoints,
  type VsDayStrategy,
  type VsPlatform,
  type VsPlanDraft,
  type VsPushDefaults,
  type VsTopN,
} from "@/lib/vs-performance/weekly-plan.shared";
import type {
  VsPlanPreview,
  VsWeekPayload,
} from "@/lib/vs-performance/weekly-view.shared";
import { conductorRuleLabelKey } from "@/lib/trains/rules/catalog.shared";
import { scopeForRule } from "@/lib/trains/rules/palette.shared";
import type { ConductorRule } from "@/lib/trains/rules/catalog.shared";

const PLATFORM_TITLE_KEYS: Record<VsPlatform, string> = {
  price_is_freight: "economy",
  save_week: "save",
  strategic_victory: "certainDays",
  all_out_domination: "allOut",
};

const STRATEGY_KEYS: Record<VsDayStrategy, string> = {
  undecided: "plan.undecided",
  push: "plan.push",
  hard_save: "plan.hardSave",
  soft_save: "plan.softSave",
  unrestricted: "plan.unrestricted",
};

const STRATEGY_ORDER: VsDayStrategy[] = [
  "undecided",
  "push",
  "hard_save",
  "soft_save",
  "unrestricted",
];

const TOP_N_OPTIONS: VsTopN[] = [1, 3, 5, 10];
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
const VS_THEME_KEYS = [
  "radarTraining",
  "baseExpansion",
  "ageOfScience",
  "heroDay",
  "totalMobilization",
  "busterDay",
] as const;

type ApiError = { error?: string; code?: string };

type Props = {
  payload: VsWeekPayload;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSaved: (payload: VsWeekPayload) => void;
  reportDirty: (dirty: boolean) => void;
  navBusy?: boolean;
};

function dayLabel(scoreDate: string, locale: string): string {
  return new Date(`${scoreDate}T12:00:00`).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function errorKeyOf(body: ApiError): string {
  const code = body.code ?? body.error ?? "save";
  return ["stale", "invalid", "forbidden"].includes(code) ? code : "save";
}

export function WeeklyVsPlan({
  payload,
  editing,
  onEditingChange,
  onSaved,
  reportDirty,
  navBusy,
}: Props) {
  const t = useTranslations("vsPerformance");
  const tRules = useTranslations("trains.rules");
  const tPlatform = useTranslations("trains.help.weekGoals");
  const tVsDays = useTranslations("trains.poolDetails.vsWeekDays");
  const locale = useLocale();

  const [draft, setDraft] = useState<VsPlanDraft | null>(null);
  const [defaults, setDefaults] = useState<VsPushDefaults>(
    payload.preferences.defaults,
  );
  const [defaultsBusy, setDefaultsBusy] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);
  const [defaultsSaved, setDefaultsSaved] = useState(false);
  const [preview, setPreview] = useState<VsPlanPreview | null>(null);
  const [reviewed, setReviewed] = useState<{
    draft: VsPlanDraft;
    reapplyDates: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reapplyDates, setReapplyDates] = useState<Record<string, boolean>>({});

  const plan = payload.plan;
  const weekStart = payload.weekStart;
  const preferenceDefaults = payload.preferences.defaults;

  const [editSession, setEditSession] = useState<{
    editing: boolean;
    weekStart: string;
  }>({ editing, weekStart });
  if (editSession.editing !== editing || editSession.weekStart !== weekStart) {
    setEditSession({ editing, weekStart });
    setPreview(null);
    setError(null);
    setReapplyDates({});
    setDraft(
      editing
        ? plan
          ? {
              weekStart: plan.weekStart,
              platform: plan.platform,
              days: plan.days.map((day) => ({ ...day })),
            }
          : buildVsPlatformDraft(
              weekStart,
              "strategic_victory",
              preferenceDefaults,
            )
        : null,
    );
    setDefaults(preferenceDefaults);
  }

  const [defaultsProp, setDefaultsProp] = useState(preferenceDefaults);
  if (defaultsProp !== preferenceDefaults) {
    setDefaultsProp(preferenceDefaults);
    if (!editing && !defaultsBusy) setDefaults(preferenceDefaults);
  }

  const dirty = editing || preview != null || busy || defaultsBusy;
  useEffect(() => {
    reportDirty(dirty);
  }, [dirty, reportDirty]);
  useEffect(() => {
    return () => reportDirty(false);
  }, [reportDirty]);

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  const planVersion = payload.plan?.version ?? 0;
  const platform = draft?.platform ?? payload.plan?.platform ?? "strategic_victory";
  const hint =
    platform === "price_is_freight"
      ? t("plan.freightHint")
      : platform === "strategic_victory"
        ? t("plan.strategicHint")
        : null;

  const days = useMemo(() => {
    if (editing && draft) return draft.days;
    return payload.days;
  }, [editing, draft, payload.days]);

  function ruleLabel(rule: ConductorRule | null): string {
    const label = tRules(conductorRuleLabelKey(rule));
    const scope = scopeForRule(rule);
    return scope != null ? `${label} ${scope}` : label;
  }

  function startEdit() {
    if (navBusy) return;
    onEditingChange(true);
  }

  function updatePlatform(next: VsPlatform) {
    setDraft((prev) => {
      const built = buildVsPlatformDraft(payload.weekStart, next, defaults);
      if (!prev) return built;
      const days = built.days.map((day, i) =>
        payload.days[i]?.editable ? day : (prev.days[i] ?? day),
      );
      return { ...built, days };
    });
  }

  function updateDay(index: number, strategy: VsDayStrategy) {
    setDraft((prev) => {
      if (!prev) return prev;
      const days = prev.days.map((day, i) => {
        if (i !== index) return day;
        return {
          ...day,
          strategy,
          heavyHitterReward:
            prev.platform === "price_is_freight" &&
            index === 4 &&
            strategy === "unrestricted",
        };
      });
      const next = { ...prev, days };
      return vsPlanDraftSchema.safeParse(next).success ? next : prev;
    });
  }

  function updateDayTopN(index: number, topN: VsTopN) {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        days: prev.days.map((day, i) =>
          i === index ? { ...day, pushTopN: topN } : day,
        ),
      };
    });
  }

  async function saveDefaults() {
    setDefaultsBusy(true);
    setDefaultsError(null);
    setDefaultsSaved(false);
    try {
      const res = await fetch("/api/vs-performance/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: payload.weekStart,
          defaults,
          expectedVersion: payload.preferences.version,
          scope: payload.scope,
        }),
      });
      const body = (await res.json()) as ApiError & {
        version?: number;
        defaults?: VsPushDefaults;
      };
      if (!res.ok) {
        setDefaultsError(t(`errors.${errorKeyOf(body)}`));
        return;
      }
      if (body.version != null && body.defaults) {
        setDefaults(body.defaults);
        setDefaultsSaved(true);
        onSaved({
          ...payload,
          preferences: { version: body.version, defaults: body.defaults },
        });
      }
    } catch {
      setDefaultsError(t("errors.save"));
    } finally {
      setDefaultsBusy(false);
    }
  }

  async function requestPreview() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vs-performance/week/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          expectedVersion: planVersion,
          scope: payload.scope,
          reapplyDates: Object.keys(reapplyDates).filter(
            (date) => reapplyDates[date],
          ),
        }),
      });
      const body = (await res.json()) as VsPlanPreview & ApiError;
      if (!res.ok) {
        setError(t(`errors.${errorKeyOf(body)}`));
        return;
      }
      if (body.scope !== payload.scope) {
        setError(t("errors.stale"));
        return;
      }
      setReviewed({
        draft,
        reapplyDates: Object.keys(reapplyDates).filter(
          (date) => reapplyDates[date],
        ),
      });
      setPreview(body);
    } catch {
      setError(t("errors.save"));
    } finally {
      setBusy(false);
    }
  }

  async function applyPlan() {
    if (!draft || !preview || !reviewed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/vs-performance/week", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: reviewed.draft,
          reapplyDates: reviewed.reapplyDates,
          expectedVersion: preview.planVersion,
          fingerprint: preview.fingerprint,
          scope: preview.scope,
        }),
      });
      const body = (await res.json()) as VsWeekPayload & ApiError;
      if (!res.ok) {
        setError(t(`errors.${errorKeyOf(body)}`));
        setPreview(null);
        setReviewed(null);
        return;
      }
      setPreview(null);
      setReviewed(null);
      onEditingChange(false);
      onSaved(body);
    } catch {
      setError(t("errors.save"));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "rounded-md border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg disabled:opacity-50";
  const protectedDates = preview?.protectedDates ?? [];

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5" data-testid="weekly-vs-plan">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-hq-fg">
            {t("plan.title")}
          </h3>
          {payload.plan != null || editing ? (
            <p className="mt-1 text-sm text-hq-fg-muted">
              {t("plan.platform")}:{" "}
              {tPlatform(`${PLATFORM_TITLE_KEYS[platform]}.title`)}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-hq-fg-muted">
            {t("points.planned", {
              count: vsPlannedPushPoints(days, payload.weekStart),
            })}
          </p>
        </div>
        {payload.canEdit && !editing ? (
          <button
            type="button"
            onClick={startEdit}
            data-testid="vs-plan-edit"
            className="shrink-0 rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-sm font-medium text-hq-fg hover:bg-hq-border"
          >
            {t("plan.edit")}
          </button>
        ) : null}
      </div>

      {payload.plan == null && !editing ? (
        <p className="mt-3 text-sm text-hq-fg-muted">{t("plan.empty")}</p>
      ) : null}
      {payload.plan?.applied != null &&
      payload.plan.applied.leadDays !== payload.leadDays ? (
        <p className="mt-3 text-xs text-[#b08800] dark:text-[#e3b341]">
          {t("sync.leadTimeChanged")}
        </p>
      ) : null}
      {hint ? (
        <p className="mt-3 text-xs text-hq-fg-muted">{hint}</p>
      ) : null}

      {editing && draft ? (
        <div className="mt-4">
          <label
            htmlFor="vs-plan-platform"
            className="text-xs font-medium text-hq-fg-muted"
          >
            {t("plan.platform")}
          </label>
          <select
            id="vs-plan-platform"
            className={`mt-1 w-full ${inputCls}`}
            value={draft.platform}
            onChange={(e) => updatePlatform(e.target.value as VsPlatform)}
            data-testid="vs-plan-platform"
          >
            {VS_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {tPlatform(`${PLATFORM_TITLE_KEYS[p]}.title`)}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <ol className="mt-4 space-y-2">
        {days.map((day, index) => {
          const effective = payload.days[index];
          const editable = editing && (effective?.editable ?? false);
          const isProtected = !(effective?.editable ?? true);
          return (
            <li
              key={day.scoreDate}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-hq-border px-3 py-2"
              data-testid={`vs-plan-day-${index}`}
            >
              <span className="w-28 shrink-0 text-sm font-medium text-hq-fg">
                {dayLabel(day.scoreDate, locale)}
              </span>
              <span className="w-32 shrink-0 text-xs text-hq-fg-muted">
                {tVsDays(VS_THEME_KEYS[index] ?? "radarTraining")} ·{" "}
                {t("points.dayValue", { count: VS_DAY_POINTS[index] ?? 0 })}
                {effective?.trainDate ? (
                  <>
                    {" "}
                    ·{" "}
                    {t("sync.trainDate", {
                      date: dayLabel(effective.trainDate, locale),
                    })}
                  </>
                ) : null}
              </span>
              {editing ? (
                <>
                  <select
                    id={`vs-plan-day-${index}-strategy`}
                    className={inputCls}
                    value={day.strategy}
                    disabled={!editable || preview != null || busy}
                    onChange={(e) =>
                      updateDay(index, e.target.value as VsDayStrategy)
                    }
                    aria-label={t("plan.strategy")}
                  >
                    {STRATEGY_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {t(STRATEGY_KEYS[s])}
                      </option>
                    ))}
                  </select>
                  {day.strategy === "push" ? (
                    <select
                      id={`vs-plan-day-${index}-topn`}
                      className={inputCls}
                      value={day.pushTopN}
                      disabled={!editable || preview != null || busy}
                      onChange={(e) =>
                        updateDayTopN(
                          index,
                          Number(e.target.value) as VsTopN,
                        )
                      }
                    >
                      {TOP_N_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {t("defaults.topN", { count: n })}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </>
              ) : (
                <span className="text-sm text-hq-fg">
                  {t(STRATEGY_KEYS[day.strategy])}
                </span>
              )}
              {editing && editable && effective?.override ? (
                <label className="flex items-center gap-1 text-xs text-hq-fg-muted">
                  <input
                    type="checkbox"
                    checked={reapplyDates[day.scoreDate] ?? false}
                    disabled={preview != null || busy}
                    onChange={(e) =>
                      setReapplyDates((prev) => ({
                        ...prev,
                        [day.scoreDate]: e.target.checked,
                      }))
                    }
                  />
                  {t("sync.after")}: {t(STRATEGY_KEYS[day.strategy])}
                </label>
              ) : null}
              <span className="ml-auto flex items-center gap-2 text-xs text-hq-fg-muted">
                {effective?.currentRule != null ? (
                  <span>
                    {t("sync.before")}: {ruleLabel(effective.currentRule)}
                  </span>
                ) : null}
                {effective?.conductorName ? (
                  <span>{effective.conductorName}</span>
                ) : null}
                {effective?.override ? (
                  <span
                    className="rounded border border-[#b08800]/40 bg-[#b08800]/10 px-1.5 py-0.5 text-[11px] font-medium text-[#8a6a00] dark:text-[#e3b341]"
                    title={t("sync.overrideHint")}
                  >
                    {t("sync.override")}
                  </span>
                ) : null}
                {isProtected ? (
                  <Lock
                    className="h-3.5 w-3.5 text-hq-fg-muted"
                    aria-label={t("plan.protected")}
                  />
                ) : null}
              </span>
            </li>
          );
        })}
        <li className="rounded-lg border border-dashed border-hq-border px-3 py-2 text-sm text-hq-fg-muted">
          {t("plan.breakDay")}
        </li>
      </ol>

      {editing ? (
        <div className="mt-4 rounded-lg border border-hq-border p-3">
          <p className="text-xs font-semibold text-hq-fg">
            {t("defaults.title")}
          </p>
          <p className="mt-1 text-xs text-hq-fg-muted">{t("defaults.body")}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {WEEKDAY_KEYS.map((key) => (
              <label key={key} className="text-xs text-hq-fg-muted">
                {new Date(
                  `${
                    days[WEEKDAY_KEYS.indexOf(key)]?.scoreDate ??
                    payload.weekStart
                  }T12:00:00`,
                ).toLocaleDateString(locale, { weekday: "short" })}
                <select
                  id={`vs-default-${key}`}
                  className={`mt-0.5 w-full ${inputCls}`}
                  value={defaults[key]}
                  onChange={(e) =>
                    setDefaults((prev) => ({
                      ...prev,
                      [key]: Number(e.target.value) as VsTopN,
                    }))
                  }
                >
                  {TOP_N_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {t("defaults.topN", { count: n })}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveDefaults()}
              disabled={defaultsBusy}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
            >
              {defaultsBusy ? t("actions.saving") : t("actions.save")}
            </button>
            {defaultsError ? (
              <p className="text-xs text-hq-danger" role="alert">
                {defaultsError}
              </p>
            ) : null}
            {defaultsSaved && !defaultsError ? (
              <p className="text-xs text-hq-fg-muted" role="status">
                {t("actions.saved")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          ref={errorRef}
          className="mt-3 text-sm text-hq-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => void requestPreview()}
            disabled={busy || !draft || preview != null}
            data-testid="vs-plan-preview"
            className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
          >
            {busy ? t("actions.saving") : t("sync.preview")}
          </button>
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setReviewed(null);
              onEditingChange(false);
            }}
            disabled={busy}
            className="rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm text-hq-fg hover:bg-hq-border disabled:opacity-50"
          >
            {t("actions.cancel")}
          </button>
        </div>
      ) : null}

      <Dialog
        open={preview != null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setPreview(null);
            setReviewed(null);
          }
        }}
        title={t("sync.preview")}
        ignoreOutsideDismiss={busy}
        data-testid="vs-plan-preview-dialog"
      >
        <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto p-5">
          {preview == null ? null : (
            <>
            <h4 className="text-base font-semibold text-hq-fg">
              {t("sync.preview")}
            </h4>
            <p className="mt-1 text-sm text-hq-fg-muted">{t("sync.body")}</p>
            {preview.changes.length === 0 ? (
              <p className="mt-4 text-sm text-hq-fg-muted">
                {t("sync.body")}
              </p>
            ) : (
              <ol className="mt-4 space-y-2">
                {preview.changes.map((change) => (
                  <li
                    key={change.scoreDate}
                    className="rounded-lg border border-hq-border p-3 text-sm"
                  >
                    <p className="font-medium text-hq-fg">
                      {t("sync.trainDate", {
                        date: dayLabel(change.trainDate, locale),
                      })}
                    </p>
                    <p className="mt-1 text-hq-fg-muted">
                      {t("sync.before")}: {ruleLabel(change.before)} →{" "}
                      {t("sync.after")}: {ruleLabel(change.after)}
                    </p>
                    {change.clearConductorName ? (
                      <p className="mt-1 text-xs text-[#b08800] dark:text-[#e3b341]">
                        {t("sync.clearDraft")} ({change.clearConductorName})
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
            {protectedDates.length > 0 ? (
              <p className="mt-3 text-xs text-hq-fg-muted">
                {t("plan.protected")}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void applyPlan()}
                disabled={busy}
                data-testid="vs-plan-apply"
                className="rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
              >
                {busy ? t("actions.saving") : t("sync.apply")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setReviewed(null);
                }}
                disabled={busy}
                className="rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm text-hq-fg hover:bg-hq-border disabled:opacity-50"
              >
                {t("actions.cancel")}
              </button>
            </div>
            </>
          )}
        </div>
      </Dialog>
    </section>
  );
}
