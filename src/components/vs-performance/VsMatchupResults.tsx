"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  formatVsTotal,
  normalizeVsResult,
  parseLocalizedVsTotal,
  type VsOutcome,
} from "@/lib/vs-performance/match-results.shared";
import type {
  VsMatchupView,
  VsSavedDayResult,
  VsWeekPayload,
} from "@/lib/vs-performance/weekly-view.shared";

type ApiError = { error?: string; code?: string };

type Props = {
  payload: VsWeekPayload;
  onSaved: (payload: VsWeekPayload) => void;
  setDraftFlag: (key: string, dirty: boolean) => void;
  navBusy?: boolean;
};

function errorKeyOf(body: ApiError): string {
  const code = body.code ?? body.error ?? "save";
  return ["stale", "invalid", "forbidden"].includes(code) ? code : "save";
}

function outcomeKey(outcome: VsOutcome): string {
  return `results.${outcome}`;
}

export function VsMatchupResults({ payload, onSaved, setDraftFlag, navBusy }: Props) {
  const t = useTranslations("vsPerformance");
  const locale = useLocale();
  const { matchup, points, canEdit } = payload;

  const [identityOpen, setIdentityOpen] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const inputCls =
    "rounded-md border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg disabled:opacity-50";

  const childFlags = useRef<Record<string, boolean>>({});
  const setFlag = useCallback(
    (key: string, dirty: boolean) => {
      childFlags.current[key] = dirty;
      setDraftFlag(
        "matchup",
        Object.values(childFlags.current).some(Boolean),
      );
    },
    [setDraftFlag],
  );

  useEffect(() => {
    setFlag("identity", identityOpen || identityBusy || importBusy);
  }, [identityOpen, identityBusy, importBusy, setFlag]);

  useEffect(() => {
    return () => setDraftFlag("matchup", false);
  }, [setDraftFlag]);

  function startIdentityEdit() {
    if (navBusy) return;
    setName(matchup?.opponentName ?? "");
    setTag(matchup?.opponentTag ?? "");
    setIdentityError(null);
    setIdentityOpen(true);
  }

  async function saveIdentity() {
    if (identityBusy) return;
    setIdentityBusy(true);
    setIdentityError(null);
    try {
      const res = await fetch("/api/vs-performance/matchup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: payload.weekStart,
          opponentName: name.trim() || null,
          opponentTag: tag.trim() || null,
          expectedVersion: matchup?.version ?? 0,
          scope: payload.scope,
        }),
      });
      const body = (await res.json()) as VsMatchupView & ApiError;
      if (!res.ok) {
        setIdentityError(t(`errors.${errorKeyOf(body)}`));
        return;
      }
      setIdentityOpen(false);
      onSaved({ ...payload, matchup: body });
    } catch {
      setIdentityError(t("errors.save"));
    } finally {
      setIdentityBusy(false);
    }
  }

  async function refreshAshed() {
    if (importBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const res = await fetch("/api/vs-performance/matchup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: payload.weekStart }),
      });
      if (!res.ok) {
        setImportError(t("matchup.importFailed"));
        return;
      }
      const body = (await res.json()) as VsMatchupView;
      onSaved({ ...payload, matchup: body });
    } catch {
      setImportError(t("matchup.importFailed"));
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-hq-border bg-hq-surface p-5"
      data-testid="vs-matchup-results"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-hq-fg">
            {matchup?.opponentName ?? t("matchup.unknown")}
            {matchup?.opponentTag ? (
              <span className="ml-2 text-sm font-normal text-hq-fg-muted">
                [{matchup.opponentTag}]
              </span>
            ) : null}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-hq-fg">
              {t("points.alliance", { count: points.alliancePoints })}
            </span>
            <span className="font-semibold text-hq-fg">
              {t("points.opponent", { count: points.opponentPoints })}
            </span>
            <span className="text-hq-fg-muted">{t("points.target")}</span>
          </div>
          <div className="mt-1 text-xs font-medium">
            {points.victory === "alliance" ? (
              <span className="text-hq-success">{t("points.secured")}</span>
            ) : points.victory === "opponent" ? (
              <span className="text-hq-danger">
                {t("points.opponentSecured")}
              </span>
            ) : points.saturdayWinSecuresWeek ? (
              <span className="text-hq-accent">
                {t("points.saturdayPath")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {canEdit ? (
            <button
              type="button"
              onClick={startIdentityEdit}
              disabled={navBusy}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
            >
              {t("matchup.opponentName")}
            </button>
          ) : null}
          {payload.canImportAshed && canEdit ? (
            <button
              type="button"
              onClick={() => void refreshAshed()}
              disabled={importBusy}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
            >
              {t("matchup.import")}
            </button>
          ) : null}
        </div>
      </div>
      {importError ? (
        <p className="mt-2 text-sm text-hq-danger" role="alert">
          {importError}
        </p>
      ) : null}

      {identityOpen ? (
        <div className="mt-3 space-y-2 rounded-lg border border-hq-border p-3">
          <input
            id="vs-matchup-name"
            className={`w-full ${inputCls}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("matchup.opponentName")}
            aria-label={t("matchup.opponentName")}
            disabled={identityBusy}
          />
          <input
            id="vs-matchup-tag"
            className={`w-full ${inputCls}`}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder={t("matchup.opponentTag")}
            aria-label={t("matchup.opponentTag")}
            disabled={identityBusy}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveIdentity()}
              disabled={identityBusy}
              className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
            >
              {identityBusy ? t("actions.saving") : t("actions.save")}
            </button>
            <button
              type="button"
              onClick={() => setIdentityOpen(false)}
              disabled={identityBusy}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-border disabled:opacity-50"
            >
              {t("actions.cancel")}
            </button>
            {identityError ? (
              <p className="text-xs text-hq-danger" role="alert">
                {identityError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <h4 className="mt-4 text-sm font-semibold text-hq-fg">
        {t("results.title")}
      </h4>
      <p className="mt-1 text-xs text-hq-fg-muted">{t("results.hint")}</p>
      <ol className="mt-2 space-y-2">
        {payload.days.map((day) => {
          const saved = matchup?.days.find(
            (d) => d.recordedDate === day.scoreDate,
          );
          const completed = day.scoreDate < payload.today;
          return (
            <DayResultRow
              key={day.scoreDate}
              scoreDate={day.scoreDate}
              completed={completed}
              saved={saved ?? null}
              matchup={matchup ?? null}
              scope={payload.scope}
              canEdit={canEdit}
              locale={locale}
              inputCls={inputCls}
              t={t}
              onSaved={onSaved}
              payload={payload}
              setFlag={setFlag}
              navBusy={navBusy}
            />
          );
        })}
      </ol>

      {(matchup?.conflicts.length ?? 0) > 0 ? (
        <ol className="mt-3 space-y-2">
          {matchup!.conflicts.map((conflict) => (
            <ConflictRow
              key={conflict.id}
              conflict={conflict}
              hqResult={
                matchup!.days.find(
                  (d) => d.recordedDate === conflict.recordedDate,
                ) ?? null
              }
              locale={locale}
              t={t}
              onSaved={onSaved}
              payload={payload}
              setFlag={setFlag}
              navBusy={navBusy}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function DayResultRow({
  scoreDate,
  completed,
  saved,
  matchup,
  scope,
  canEdit,
  locale,
  inputCls,
  t,
  onSaved,
  payload,
  setFlag,
  navBusy,
}: {
  scoreDate: string;
  completed: boolean;
  saved: VsSavedDayResult | null;
  matchup: VsMatchupView | null;
  scope: string;
  canEdit: boolean;
  locale: string;
  inputCls: string;
  t: ReturnType<typeof useTranslations>;
  onSaved: (payload: VsWeekPayload) => void;
  payload: VsWeekPayload;
  setFlag: (key: string, dirty: boolean) => void;
  navBusy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [our, setOur] = useState("");
  const [opp, setOpp] = useState("");
  const [outcome, setOutcome] = useState<VsOutcome>(saved?.outcome ?? "pending");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef<{ id: string; body: string } | null>(null);

  useEffect(() => {
    setFlag(`day:${scoreDate}`, open || busy);
  }, [open, busy, scoreDate, setFlag]);
  useEffect(() => {
    return () => setFlag(`day:${scoreDate}`, false);
  }, [scoreDate, setFlag]);

  const dateLabel = new Date(`${scoreDate}T12:00:00`).toLocaleDateString(
    locale,
    { month: "short", day: "numeric", weekday: "short" },
  );

  const hasTotals = our.trim().length > 0 || opp.trim().length > 0;
  let derivedOutcome: VsOutcome | null = null;
  let totalsError = false;
  if (hasTotals) {
    try {
      const ours = parseLocalizedVsTotal(our, locale);
      const opps = parseLocalizedVsTotal(opp, locale);
      const o = BigInt(ours);
      const p = BigInt(opps);
      derivedOutcome = o > p ? "won" : o < p ? "lost" : null;
    } catch {
      totalsError = true;
    }
  }

  function startEdit() {
    if (navBusy) return;
    setOur(saved?.totals ? formatVsTotal(saved.totals.ourScore, locale) : "");
    setOpp(saved?.totals ? formatVsTotal(saved.totals.opponentScore, locale) : "");
    setOutcome(saved?.outcome ?? "pending");
    requestRef.current = null;
    setError(null);
    setOpen(true);
  }

  async function save() {
    if (busy || !matchup) return;
    if (totalsError || (our.trim() === "") !== (opp.trim() === "")) {
      setError(t("results.invalidTotals"));
      return;
    }
    let totals: { ourScore: string; opponentScore: string } | null = null;
    if (our.trim() && opp.trim()) {
      try {
        totals = {
          ourScore: parseLocalizedVsTotal(our, locale),
          opponentScore: parseLocalizedVsTotal(opp, locale),
        };
      } catch {
        setError(t("results.invalidTotals"));
        return;
      }
    }
    const reportedOutcome =
      totals && derivedOutcome != null ? derivedOutcome : outcome;
    try {
      normalizeVsResult({
        totals,
        reportedOutcome,
        finality: "final",
      });
    } catch {
      setError(t("results.resultMismatch"));
      return;
    }
    const requestBody = JSON.stringify({
      totals,
      reportedOutcome,
      finality: "final",
    });
    if (requestRef.current?.body !== requestBody) {
      requestRef.current = { id: crypto.randomUUID(), body: requestBody };
    }
    const requestId = requestRef.current.id;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vs-performance/matchup/days/${encodeURIComponent(scoreDate)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            matchupId: matchup.id,
            expectedVersion: saved?.version ?? 0,
            requestId,
            totals,
            reportedOutcome,
            finality: "final",
            scope,
          }),
        },
      );
      const body = (await res.json()) as ApiError & { id?: string };
      if (!res.ok) {
        setError(t(`errors.${errorKeyOf(body)}`));
        return;
      }
      const refreshed = await fetch(
        `/api/vs-performance/week?weekStart=${encodeURIComponent(payload.weekStart)}`,
      );
      if (!refreshed.ok) {
        setError(t("errors.load"));
        return;
      }
      requestRef.current = null;
      setOpen(false);
      onSaved((await refreshed.json()) as VsWeekPayload);
    } catch {
      setError(t("errors.save"));
    } finally {
      setBusy(false);
    }
  }

  const sourceLabel = saved
    ? saved.source === "ashed_import"
      ? t("results.sourceAshed")
      : t("results.sourceHq")
    : null;

  return (
    <li
      className="rounded-lg border border-hq-border px-3 py-2"
      data-testid={`vs-result-${scoreDate}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-28 shrink-0 text-sm font-medium text-hq-fg">
          {dateLabel}
        </span>
        {saved ? (
          <>
            <span
              className={`text-sm font-semibold ${
                saved.outcome === "won"
                  ? "text-hq-success"
                  : saved.outcome === "lost"
                    ? "text-hq-danger"
                    : "text-hq-fg-muted"
              }`}
            >
              {t(outcomeKey(saved.outcome))}
            </span>
            {saved.totals ? (
              <span className="text-xs text-hq-fg-muted">
                {formatVsTotal(saved.totals.ourScore, locale)} –{" "}
                {formatVsTotal(saved.totals.opponentScore, locale)}
              </span>
            ) : null}
            <span className="text-xs text-hq-fg-muted">{sourceLabel}</span>
          </>
        ) : (
          <span className="text-sm text-hq-fg-muted">
            {t("results.pending")}
          </span>
        )}
        {canEdit && completed && matchup ? (
          <button
            type="button"
            onClick={startEdit}
            disabled={navBusy}
            className="ml-auto rounded-lg border border-hq-border bg-hq-surface-muted px-2.5 py-1 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
          >
            {t("results.label")}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-2 border-t border-hq-border pt-2">
          <p className="text-xs text-hq-fg-muted">{t("results.totalsHint")}</p>
          <div className="flex flex-wrap gap-2">
            <input
              id={`vs-totals-our-${scoreDate}`}
              className={`w-40 ${inputCls}`}
              value={our}
              inputMode="numeric"
              onChange={(e) => setOur(e.target.value)}
              placeholder={t("results.ourTotal")}
              aria-label={t("results.ourTotal")}
              disabled={busy}
            />
            <input
              id={`vs-totals-opp-${scoreDate}`}
              className={`w-40 ${inputCls}`}
              value={opp}
              inputMode="numeric"
              onChange={(e) => setOpp(e.target.value)}
              placeholder={t("results.opponentTotal")}
              aria-label={t("results.opponentTotal")}
              disabled={busy}
            />
          </div>
          {hasTotals && derivedOutcome != null ? (
            <p className="text-xs text-hq-fg-muted">
              {t("results.label")}: {t(outcomeKey(derivedOutcome))}
            </p>
          ) : null}
          {hasTotals && !totalsError && derivedOutcome == null ? (
            <p className="text-xs text-hq-fg-muted">
              {t("results.equalTotals")}
            </p>
          ) : null}
          {!(hasTotals && !totalsError && derivedOutcome != null) ? (
            <div className="flex items-center gap-2">
              <label
                htmlFor={`vs-outcome-${scoreDate}`}
                className="text-xs text-hq-fg-muted"
              >
                {t("results.label")}
              </label>
              <select
                id={`vs-outcome-${scoreDate}`}
                className={inputCls}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as VsOutcome)}
                disabled={busy}
              >
                <option value="pending">{t("results.pending")}</option>
                <option value="won">{t("results.won")}</option>
                <option value="lost">{t("results.lost")}</option>
              </select>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
            >
              {busy ? t("actions.saving") : t("results.saveTotals")}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-border disabled:opacity-50"
            >
              {t("actions.cancel")}
            </button>
            {error ? (
              <p className="text-xs text-hq-danger" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ConflictRow({
  conflict,
  hqResult,
  locale,
  t,
  onSaved,
  payload,
  setFlag,
  navBusy,
}: {
  conflict: VsMatchupView["conflicts"][number];
  hqResult: VsSavedDayResult | null;
  locale: string;
  t: ReturnType<typeof useTranslations>;
  onSaved: (payload: VsWeekPayload) => void;
  payload: VsWeekPayload;
  setFlag: (key: string, dirty: boolean) => void;
  navBusy?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    setFlag(`conflict:${conflict.id}`, busy);
  }, [busy, conflict.id, setFlag]);
  useEffect(() => {
    return () => setFlag(`conflict:${conflict.id}`, false);
  }, [conflict.id, setFlag]);

  if (resolved) return null;

  const dateLabel = new Date(
    `${conflict.recordedDate}T12:00:00`,
  ).toLocaleDateString(locale, { month: "short", day: "numeric" });

  async function resolveConflict(action: "keep_hq" | "use_ashed") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vs-performance/matchup/conflicts/${encodeURIComponent(conflict.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            nativeVersion: conflict.nativeVersion,
            scope: payload.scope,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as ApiError;
        setError(t(`errors.${errorKeyOf(body)}`));
        return;
      }
      const refreshed = await fetch(
        `/api/vs-performance/week?weekStart=${encodeURIComponent(payload.weekStart)}`,
      );
      if (!refreshed.ok) {
        setError(t("errors.load"));
        return;
      }
      setResolved(true);
      onSaved((await refreshed.json()) as VsWeekPayload);
    } catch {
      setError(t("errors.save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className="rounded-lg border border-[#b08800]/40 bg-[#b08800]/10 px-3 py-2 text-sm"
      data-testid={`vs-conflict-${conflict.id}`}
    >
      <p className="font-medium text-[#8a6a00] dark:text-[#e3b341]">
        {dateLabel} — {t("results.ashedConflict")}
      </p>
      <p className="mt-1 text-xs text-hq-fg-muted">
        {t("results.keepHq")}:{" "}
        {hqResult ? t(outcomeKey(hqResult.outcome)) : t("results.pending")}
        {hqResult?.totals
          ? ` (${formatVsTotal(hqResult.totals.ourScore, locale)} – ${formatVsTotal(hqResult.totals.opponentScore, locale)})`
          : ""}
      </p>
      <p className="mt-1 text-xs text-hq-fg-muted">
        {t("results.reviewAshed")}: {t(outcomeKey(conflict.result.outcome))}
        {conflict.result.totals
          ? ` (${formatVsTotal(conflict.result.totals.ourScore, locale)} – ${formatVsTotal(conflict.result.totals.opponentScore, locale)})`
          : ""}
      </p>
      {payload.canEdit ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void resolveConflict("use_ashed")}
            disabled={busy || navBusy}
            className="rounded-lg border border-hq-border bg-hq-surface px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
          >
            {t("results.useAshed")}
          </button>
          <button
            type="button"
            onClick={() => void resolveConflict("keep_hq")}
            disabled={busy || navBusy}
            className="rounded-lg border border-hq-border bg-hq-surface px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
          >
            {t("results.keepHq")}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-1 text-xs text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
