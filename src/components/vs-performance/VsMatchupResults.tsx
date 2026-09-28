"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

import {
  formatVsTotal,
  normalizeVsResult,
  parseLocalizedVsTotal,
  type VsOutcome,
} from "@/lib/vs-performance/match-results.shared";
import {
  formatVsScoreDifference,
  type VsMemberScoreCheck,
} from "@/lib/vs-performance/member-score-check.shared";
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

function weekPayloadMatchesView(
  body: VsWeekPayload,
  payload: VsWeekPayload,
): boolean {
  return (
    body.contextScope === payload.contextScope &&
    body.weekStart === payload.weekStart
  );
}

function outcomeKey(outcome: VsOutcome): string {
  return `results.${outcome}`;
}

export function VsMatchupResults({ payload, onSaved, setDraftFlag, navBusy }: Props) {
  const t = useTranslations("vsPerformance");
  const tConnect = useTranslations("connect");
  const locale = useLocale();
  const { matchup, points, canEdit } = payload;

  const [identityOpen, setIdentityOpen] = useState(false);
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [server, setServer] = useState("");
  const [weekOutcome, setWeekOutcome] = useState<"pending" | "win" | "loss">(
    "pending",
  );
  const [oppScores, setOppScores] = useState<string[]>(Array(6).fill(""));
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [previousOpponents, setPreviousOpponents] = useState<
    Array<{ server: number | null; tag: string | null; name: string | null }>
  >([]);
  const [previousLoaded, setPreviousLoaded] = useState(false);
  const importErrorRef = useRef<HTMLParagraphElement | null>(null);
  const syncErrorRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    if (importError)
      importErrorRef.current?.scrollIntoView({ block: "nearest" });
  }, [importError]);
  useEffect(() => {
    if (syncError)
      syncErrorRef.current?.scrollIntoView({ block: "nearest" });
  }, [syncError]);

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
    setFlag(
      "identity",
      identityOpen || identityBusy || importBusy || syncBusy,
    );
  }, [identityOpen, identityBusy, importBusy, syncBusy, setFlag]);

  useEffect(() => {
    return () => setDraftFlag("matchup", false);
  }, [setDraftFlag]);

  function startIdentityEdit() {
    if (navBusy) return;
    setName(matchup?.opponentName ?? "");
    setTag(matchup?.opponentTag ?? "");
    setServer(
      matchup?.opponentServer != null ? String(matchup.opponentServer) : "",
    );
    setWeekOutcome(matchup?.weekOutcome ?? "pending");
    setOppScores(
      Array.from({ length: 6 }, (_, index) =>
        matchup?.opponentDailyScores?.[index] ?? "",
      ),
    );
    setIdentityError(null);
    setIdentityOpen(true);
    if (!previousLoaded) {
      setPreviousLoaded(true);
      void (async () => {
        try {
          const res = await fetch("/api/vs-performance/matchup/opponents");
          if (!res.ok) {
            setIdentityError(t("errors.load"));
            return;
          }
          const body = (await res.json()) as {
            opponents: Array<{
              server: number | null;
              tag: string | null;
              name: string | null;
            }>;
          };
          setPreviousOpponents(body.opponents);
        } catch {
          setIdentityError(t("errors.load"));
        }
      })();
    }
  }

  function confirmedDayIndex(index: number): boolean {
    const date = payload.days[index]?.scoreDate;
    if (!date) return false;
    const saved = matchup?.days.find((d) => d.recordedDate === date);
    return (
      saved?.finality === "final" &&
      saved.totals != null &&
      saved.hqConfirmed
    );
  }

  async function saveIdentity() {
    if (identityBusy) return;
    setIdentityBusy(true);
    setIdentityError(null);
    const opponentScores: Array<{ day: number; score: string | null }> = [];
    try {
      oppScores.forEach((value, index) => {
        const current = matchup?.opponentDailyScores?.[index] ?? null;
        const trimmed = value.trim();
        if (confirmedDayIndex(index)) return;
        const next =
          trimmed === ""
            ? null
            : parseLocalizedVsTotal(trimmed, locale);
        if (next !== current) {
          opponentScores.push({ day: index + 1, score: next });
        }
      });
    } catch {
      setIdentityBusy(false);
      setIdentityError(t("results.invalidTotals"));
      return;
    }
    const serverValue = server.trim();
    try {
      const res = await fetch("/api/vs-performance/matchup", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: payload.weekStart,
          opponentName: name.trim() || null,
          opponentTag: tag.trim() || null,
          opponentServer:
            serverValue === "" ? null : Number(serverValue),
          weekOutcome,
          ...(opponentScores.length > 0 ? { opponentScores } : {}),
          expectedVersion: matchup?.version ?? 0,
          scope: payload.scope,
        }),
      });
      const body = (await res.json()) as VsMatchupView & ApiError & { week: VsWeekPayload };
      if (!res.ok) {
        setIdentityError(
          body.code === "confirmed_day"
            ? t("matchup.confirmedDayHint")
            : t(`errors.${errorKeyOf(body)}`),
        );
        return;
      }
      if (!body.week || body.week.scope !== payload.scope || body.week.contextScope !== payload.contextScope) {
        setIdentityError(t("errors.load"));
        return;
      }
      setIdentityOpen(false);
      onSaved(body.week);
    } catch {
      setIdentityError(t("errors.save"));
    } finally {
      setIdentityBusy(false);
    }
  }

  async function refreshAshed() {
    if (importBusy || syncBusy || navBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const res = await fetch("/api/vs-performance/matchup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: payload.weekStart,
          scope: payload.scope,
        }),
      });
      if (!res.ok) {
        setImportError(t("matchup.importFailed"));
        return;
      }
      const body = (await res.json()) as VsWeekPayload;
      onSaved(body);
    } catch {
      setImportError(t("matchup.importFailed"));
    } finally {
      setImportBusy(false);
    }
  }

  async function syncWithAshed(
    resolution?: "keep_hq" | "use_ashed",
  ) {
    if (syncBusy || importBusy || navBusy) return;
    setSyncBusy(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/vs-performance/matchup/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: payload.weekStart,
          scope: payload.scope,
          ...(resolution
            ? { resolution, conflictToken: matchup?.sync.conflictToken }
            : {}),
        }),
      });
      const body = (await res.json()) as VsWeekPayload & ApiError;
      if (!res.ok) {
        setSyncError(body.code === "confirmed_day" ? t("matchup.confirmedDayHint") : body.code === "stale" || body.code === "busy" ? t("errors.stale") : body.code === "forbidden" ? t("errors.forbidden") : body.code === "score_too_large" ? t("ashedSync.tooLarge") : t("ashedSync.failed"));
        return;
      }
      onSaved(body);
    } catch {
      setSyncError(t("ashedSync.failed"));
    } finally {
      setSyncBusy(false);
    }
  }

  const syncStatusKey = !payload.ashedLinked ? null :
    matchup?.sync.errorCode === "credentials_required"
      ? "credentials"
      : matchup?.sync.errorCode === "score_too_large"
      ? "tooLarge"
      : matchup?.sync.status === "synced"
        ? "synced"
        : matchup?.sync.status === "pending" ||
            matchup?.sync.status === "idle"
          ? matchup?.sync.status === "pending"
            ? "pending"
            : null
          : matchup?.sync.status === "conflict"
            ? "conflict"
            : matchup?.sync.status === "credentials_required"
              ? "credentials"
              : matchup?.sync.status === "uncertain"
                ? "uncertain"
                : "failed";

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
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-hq-fg-muted">
            {matchup?.opponentServer != null ? (
              <span>
                {t("matchup.opponentServer")}: {matchup.opponentServer}
              </span>
            ) : null}
            {matchup && matchup.weekOutcome !== "pending" ? (
              <span>
                {t("matchup.weekOutcome")}:{" "}
                {t(
                  matchup.weekOutcome === "win"
                    ? "results.won"
                    : "results.lost",
                )}
              </span>
            ) : null}
          </div>
          {matchup &&
          matchup.reportedOurPoints != null &&
          matchup.reportedOpponentPoints != null ? (
            <div
              className="mt-1 text-xs text-hq-fg-muted"
              data-testid="vs-reported-points"
            >
              {t("capture.weekType")}: {t("capture.ourPoints")}{" "}
              {matchup.reportedOurPoints} · {t("capture.opponentPoints")}{" "}
              {matchup.reportedOpponentPoints}
              {matchup.reportedPointsAt
                ? ` — ${t("actions.saved")} ${new Date(matchup.reportedPointsAt).toLocaleString(locale)}`
                : ""}
            </div>
          ) : null}
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
          {payload.ashedLinked && canEdit ? (
            <>
              {payload.canImportAshed ? (
                <>
                  <button
                    type="button"
                    onClick={() => void refreshAshed()}
                    disabled={importBusy || syncBusy || navBusy}
                    className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
                  >
                    {t("matchup.import")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void syncWithAshed()}
                    disabled={syncBusy || importBusy || navBusy}
                    className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border disabled:opacity-50"
                    data-testid="vs-sync-action"
                  >
                    {t("ashedSync.action")}
                  </button>
                </>
              ) : (
                <Link
                  href="/connect"
                  className="rounded-lg border border-hq-border bg-hq-surface px-3 py-1.5 text-xs font-medium text-hq-fg hover:bg-hq-border"
                >
                  {tConnect("title")}
                </Link>
              )}
            </>
          ) : null}
        </div>
      </div>
      {importError ? (
        <p
          ref={importErrorRef}
          className="mt-2 text-sm text-hq-danger"
          role="alert"
        >
          {importError}
        </p>
      ) : null}
      {syncError ? (
        <p
          ref={syncErrorRef}
          className="mt-2 text-sm text-hq-danger"
          role="alert"
        >
          {syncError}
        </p>
      ) : null}
      {matchup && syncStatusKey ? (
        <p
          className="mt-2 text-xs text-hq-fg-muted"
          data-testid="vs-sync-status"
        >
          {t(`ashedSync.${syncStatusKey}`)}
        </p>
      ) : null}
      {payload.ashedLinked && (matchup?.sync.conflicts.length ?? 0) > 0 ? (
        <div
          className="mt-2 rounded-lg border border-hq-border p-3"
          data-testid="vs-sync-conflicts"
        >
          <ol className="space-y-1">
            {matchup!.sync.conflicts.map((conflict) => {
              const fieldLabel = conflict.field.startsWith("day:")
                ? t("matchup.day", { day: Number(conflict.field.slice(4)) })
                : t(`matchup.${conflict.field}`);
              const valueLabel = (value: string | number | null) => {
                if (conflict.field === "weekOutcome") {
                  return value === "win"
                    ? t("results.won")
                    : value === "loss"
                      ? t("results.lost")
                      : t("results.pending");
                }
                if (value == null) return "—";
                if (conflict.field.startsWith("day:")) {
                  return formatVsTotal(String(value), locale);
                }
                return String(value);
              };
              let preview: {
                hqLine: string;
                ashedLine: string;
              } | null = null;
              if (conflict.field.startsWith("day:")) {
                const dayIndex = Number(conflict.field.slice(4)) - 1;
                const date = payload.days[dayIndex]?.scoreDate;
                const head = matchup!.days.find(
                  (d) => d.recordedDate === date,
                );
                const remote = conflict.ashedValue;
                if (
                  head?.totals &&
                  remote != null &&
                  /^\d+$/.test(String(remote))
                ) {
                  try {
                    const next = normalizeVsResult({
                      totals: {
                        ourScore: head.totals.ourScore,
                        opponentScore: String(remote),
                      },
                      reportedOutcome: null,
                      finality: "final",
                    });
                    preview = {
                      hqLine: `${t("results.sourceHq")}: ${t(outcomeKey(head.outcome))} (${formatVsTotal(head.totals.ourScore, locale)} – ${formatVsTotal(head.totals.opponentScore, locale)})`,
                      ashedLine: `${t("results.sourceAshed")}: ${t(outcomeKey(next.outcome))} (${formatVsTotal(head.totals.ourScore, locale)} – ${formatVsTotal(String(remote), locale)})`,
                    };
                  } catch {
                    preview = null;
                  }
                }
              }
              return (
                <li key={conflict.field} className="text-xs text-hq-fg">
                  {fieldLabel}:{" "}
                  {t("results.sourceHq")} {valueLabel(conflict.hqValue)} /{" "}
                  {t("results.sourceAshed")} {valueLabel(conflict.ashedValue)}
                  {preview ? (
                    <span className="block text-hq-fg-muted">
                      {preview.hqLine} → {preview.ashedLine}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {canEdit ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void syncWithAshed("keep_hq")}
                disabled={syncBusy || importBusy || navBusy}
                className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
              >
                {t("ashedSync.keepHq")}
              </button>
              <button
                type="button"
                onClick={() => void syncWithAshed("use_ashed")}
                disabled={syncBusy || importBusy || navBusy}
                className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-border disabled:opacity-50"
              >
                {t("ashedSync.useAshed")}
              </button>
            </div>
          ) : null}
        </div>
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
          <input
            id="vs-matchup-server"
            className={`w-full ${inputCls}`}
            value={server}
            inputMode="numeric"
            onChange={(e) => setServer(e.target.value)}
            placeholder={t("matchup.opponentServer")}
            aria-label={t("matchup.opponentServer")}
            disabled={identityBusy}
          />
          {previousOpponents.length > 0 ? (
            <select
              id="vs-matchup-previous"
              className={`w-full ${inputCls}`}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value === "") return;
                const pick = previousOpponents[Number(e.target.value)];
                if (!pick) return;
                setName(pick.name ?? "");
                setTag(pick.tag ?? "");
                setServer(pick.server != null ? String(pick.server) : "");
              }}
              aria-label={t("matchup.previousOpponents")}
              disabled={identityBusy}
              data-testid="vs-matchup-previous"
            >
              <option value="">{t("matchup.selectPrevious")}</option>
              {previousOpponents.map((opponent, index) => (
                <option key={index} value={index}>
                  {[opponent.name, opponent.tag, opponent.server]
                    .filter((v) => v != null)
                    .join(" · ")}
                </option>
              ))}
            </select>
          ) : null}
          <label className="flex items-center gap-2 text-xs text-hq-fg-muted">
            {t("matchup.weekOutcome")}
            <select
              id="vs-matchup-weekoutcome"
              className={inputCls}
              value={weekOutcome}
              onChange={(e) =>
                setWeekOutcome(e.target.value as "pending" | "win" | "loss")
              }
              disabled={identityBusy}
            >
              <option value="pending">{t("results.pending")}</option>
              <option value="win">{t("results.won")}</option>
              <option value="loss">{t("results.lost")}</option>
            </select>
          </label>
          <p className="text-xs text-hq-fg-muted">
            {t("matchup.opponentOnlyHint")}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {oppScores.map((value, index) => {
              const locked = confirmedDayIndex(index);
              return (
                <div key={index}>
                  <input
                    id={`vs-matchup-opp-${index + 1}`}
                    className={`w-full ${inputCls}`}
                    value={value}
                    inputMode="numeric"
                    onChange={(e) =>
                      setOppScores(
                        oppScores.map((v, i) =>
                          i === index ? e.target.value : v,
                        ),
                      )
                    }
                    placeholder={t("matchup.day", { day: index + 1 })}
                    aria-label={`${t("matchup.day", { day: index + 1 })} ${t("matchup.opponentScore")}`}
                    disabled={identityBusy || locked}
                  />
                  {locked ? (
                    <p className="mt-0.5 text-[10px] text-hq-fg-muted">
                      {t("matchup.confirmedDayHint")}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
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
          const check = payload.memberScoreChecks?.[day.scoreDate] ?? null;
          return (
            <DayResultRow
              key={day.scoreDate}
              scoreDate={day.scoreDate}
              completed={completed}
              saved={saved ?? null}
              check={check}
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
  check,
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
  check: VsMemberScoreCheck | null;
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

  const importedOpponentScore = (() => {
    const index = payload.days.findIndex((d) => d.scoreDate === scoreDate);
    return index >= 0 ? (matchup?.opponentDailyScores?.[index] ?? null) : null;
  })();

  function startEdit() {
    if (navBusy) return;
    setOur(saved?.totals ? formatVsTotal(saved.totals.ourScore, locale) : "");
    setOpp(
      saved?.totals
        ? formatVsTotal(saved.totals.opponentScore, locale)
        : importedOpponentScore != null
          ? formatVsTotal(importedOpponentScore, locale)
          : "",
    );
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
      const refreshedBody = (await refreshed.json()) as VsWeekPayload;
      if (!weekPayloadMatchesView(refreshedBody, payload)) {
        setError(t("errors.stale"));
        return;
      }
      requestRef.current = null;
      setOpen(false);
      onSaved(refreshedBody);
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

  const checkLine =
    saved?.finality === "final" && saved.totals && check
      ? check.status === "match"
        ? t("reconcile.match")
        : check.status === "missing"
          ? t("reconcile.noRows")
          : check.status === "unavailable"
            ? t("reconcile.unavailable")
            : `${t("reconcile.mismatch", {
                uploaded: new Intl.NumberFormat(locale).format(
                  BigInt(check.uploadedTotal ?? "0"),
                ),
                confirmed: new Intl.NumberFormat(locale).format(
                  BigInt(check.confirmedTotal),
                ),
                difference: formatVsScoreDifference(
                  check.difference ?? "0",
                  locale,
                ),
              })} ${t("reconcile.hint")}`
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
            {checkLine ? (
              <span
                className={`text-xs ${
                  check?.status === "match"
                    ? "text-hq-fg-muted"
                    : check?.status === "shortfall" ||
                        check?.status === "excess"
                      ? "text-hq-accent"
                      : "text-hq-fg-muted"
                }`}
                data-testid={`vs-reconcile-${scoreDate}`}
                title={t("reconcile.title")}
              >
                {checkLine}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-sm text-hq-fg-muted">
              {t("results.pending")}
            </span>
            {importedOpponentScore != null ? (
              <span className="text-xs text-hq-fg-muted">
                {t("matchup.opponentScore")}:{" "}
                {formatVsTotal(importedOpponentScore, locale)}
              </span>
            ) : null}
          </>
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
      const refreshedBody = (await refreshed.json()) as VsWeekPayload;
      if (!weekPayloadMatchesView(refreshedBody, payload)) {
        setError(t("errors.stale"));
        return;
      }
      setResolved(true);
      onSaved(refreshedBody);
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
