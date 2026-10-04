"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { ScreenshotLightbox } from "@/components/ui/ScreenshotLightbox";
import { useSearchParams } from "next/navigation";

import { usePathname, useRouter } from "@/i18n/navigation";
import { parseLocalizedVsTotal } from "@/lib/vs-performance/match-results.shared";
import type {
  VsCaptureAlliance,
  VsCaptureCandidate,
  VsCaptureKind,
} from "@/lib/vs-performance/vs-capture.shared";
import { vsDatesForWeek } from "@/lib/vs-performance/weekly-plan.shared";
import type {
  VsMatchupView,
  VsWeekPayload,
} from "@/lib/vs-performance/weekly-view.shared";

type Stage = { file: File; previewUrl: string };
type Staged = {
  reviewId: string;
  version: number;
  candidate: VsCaptureCandidate;
  expiresAt: string;
  contextScope: string;
};

type ApiError = { error?: string; code?: string };

type Props = {
  payload: VsWeekPayload;
  onSaved: (payload: VsWeekPayload) => void;
  setDraftFlag: (key: string, dirty: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const inputCls =
  "rounded-md border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg disabled:opacity-50";

function blankAlliance(): VsCaptureAlliance {
  return { server: null, tag: null, name: null };
}

function captureErrorKey(body: ApiError): string {
  const code = body.code ?? body.error ?? "";
  if (code === "capture_point_mismatch") return "pointMismatch";
  if (code === "stale" || code === "expired") return "expired";
  if (code === "capture_invalid" || code === "invalid") return "invalid";
  return "invalid";
}

export function VsScreenshotCapture({
  payload,
  onSaved,
  setDraftFlag,
  open,
  onOpenChange,
}: Props) {
  const t = useTranslations("vsPerformance");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState<VsCaptureKind>("weekly_overview");
  const [stage, setStage] = useState<Stage | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const [weekStart, setWeekStart] = useState(payload.weekStart);
  const [weekData, setWeekData] = useState<VsWeekPayload | null>(null);
  const [ourSide, setOurSide] = useState<"left" | "right">("left");
  const [confirmSides, setConfirmSides] = useState(false);
  const [left, setLeft] = useState<VsCaptureAlliance>(blankAlliance());
  const [right, setRight] = useState<VsCaptureAlliance>(blankAlliance());
  const [day, setDay] = useState<number | null>(null);
  const [leftScore, setLeftScore] = useState("");
  const [rightScore, setRightScore] = useState("");
  const [finalDay, setFinalDay] = useState(false);
  const [leftPoints, setLeftPoints] = useState("");
  const [rightPoints, setRightPoints] = useState("");
  const [winners, setWinners] = useState<
    Array<"left" | "right" | "unknown">
  >(Array(6).fill("unknown"));
  const requestRef = useRef<{ id: string; body: string } | null>(null);
  const parseSeq = useRef(0);
  const saveSeq = useRef(0);
  const errorAnchor = useRef<HTMLParagraphElement>(null);
  const weekFetchSeq = useRef(0);
  const prevScope = useRef(payload.contextScope);

  const effective: VsWeekPayload | null =
    weekStart === payload.weekStart
      ? payload
      : weekData && weekData.weekStart === weekStart
        ? weekData
        : null;

  useEffect(() => () => {
    parseSeq.current += 1;
    saveSeq.current += 1;
    weekFetchSeq.current += 1;
  }, []);

  useEffect(() => {
    if (error) errorAnchor.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  useEffect(() => {
    setDraftFlag("capture", open || busy);
    return () => setDraftFlag("capture", false);
  }, [open, busy, setDraftFlag]);

  useEffect(() => {
    return () => {
      if (stage) URL.revokeObjectURL(stage.previewUrl);
    };
  }, [stage]);

  useEffect(() => {
    if (prevScope.current === payload.contextScope) return;
    prevScope.current = payload.contextScope;
    if (stage) URL.revokeObjectURL(stage.previewUrl);
    setStage(null);
    setStaged(null);
    setWeekData(null);
    setError(null);
    setConfirmSides(false);
    setFinalDay(false);
    setDay(null);
    setBusy(false);
    setWeekStart(payload.weekStart);
    setLightboxOpen(false);
    requestRef.current = null;
    saveSeq.current += 1;
    parseSeq.current += 1;
    weekFetchSeq.current += 1;
    onOpenChange(false);
  }, [payload.contextScope, payload.weekStart, stage, onOpenChange]);

  useEffect(() => {
    const seq = ++weekFetchSeq.current;
    if (!open || weekStart === payload.weekStart) return;
    const scope = payload.contextScope;
    queueMicrotask(() => {
      if (seq === weekFetchSeq.current) setWeekData(null);
    });
    void (async () => {
      try {
        const res = await fetch(
          `/api/vs-performance/week?weekStart=${encodeURIComponent(weekStart)}`,
        );
        const body = (await res.json()) as VsWeekPayload & ApiError;
        if (seq !== weekFetchSeq.current || prevScope.current !== scope) return;
        if (!res.ok || body.contextScope !== scope || body.weekStart !== weekStart) {
          setError(t("capture.invalid"));
          return;
        }
        setWeekData(body);
      } catch {
        if (seq === weekFetchSeq.current && prevScope.current === scope) setError(t("errors.load"));
      }
    })();
  }, [open, weekStart, payload.weekStart, payload.contextScope, t]);

  function reset() {
    if (stage) URL.revokeObjectURL(stage.previewUrl);
    setStage(null);
    setStaged(null);
    setError(null);
    setConfirmSides(false);
    setFinalDay(false);
    setWeekStart(payload.weekStart);
    setWeekData(null);
    setDay(null);
    setLightboxOpen(false);
    requestRef.current = null;
    parseSeq.current += 1;
    weekFetchSeq.current += 1;
  }

  function close() {
    if (busy) return;
    reset();
    onOpenChange(false);
  }

  function pickFile(file: File | null) {
    if (!file) return;
    if (stage) URL.revokeObjectURL(stage.previewUrl);
    setStage({ file, previewUrl: URL.createObjectURL(file) });
    setStaged(null);
    setError(null);
    setConfirmSides(false);
    setFinalDay(false);
    setDay(null);
    requestRef.current = null;
  }

  async function parse() {
    if (busy || !stage) return;
    const seq = ++parseSeq.current;
    const scope = payload.contextScope;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("image", stage.file);
      form.set("kind", kind);
      form.set("weekStart", payload.weekStart);
      form.set("scope", payload.scope);
      const res = await fetch("/api/vs-performance/captures/parse", {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as Staged & ApiError;
      if (seq !== parseSeq.current) return;
      if (!res.ok) {
        setError(t("capture.failed"));
        return;
      }
      if (body.contextScope !== scope) return;
      const candidate = body.candidate;
      setStaged(body);
      setWeekStart(payload.weekStart);
      setLeft(candidate.left ?? blankAlliance());
      setRight(candidate.right ?? blankAlliance());
      setOurSide("left");
      setConfirmSides(false);
      setDay(candidate.day ?? null);
      setLeftScore(candidate.leftScore ?? "");
      setRightScore(candidate.rightScore ?? "");
      setLeftPoints(
        candidate.leftPoints != null ? String(candidate.leftPoints) : "",
      );
      setRightPoints(
        candidate.rightPoints != null ? String(candidate.rightPoints) : "",
      );
      setWinners(candidate.dayResults.map((d) => d.winner));
      setFinalDay(false);
    } catch {
      if (seq === parseSeq.current) setError(t("capture.failed"));
    } finally {
      if (seq === parseSeq.current) setBusy(false);
    }
  }

  function buildReview(): Record<string, unknown> | null {
    const points = (value: string) =>
      value.trim() === "" ? null : Number(value);
    const base = {
      weekStart,
      ourSide,
      confirmSides: true as const,
      left,
      right,
    };
    if (kind === "daily_totals") {
      if (day == null) return null;
      let parsedLeft: string | null = null;
      let parsedRight: string | null = null;
      try {
        parsedLeft =
          leftScore.trim() === ""
            ? null
            : parseLocalizedVsTotal(leftScore, locale);
        parsedRight =
          rightScore.trim() === ""
            ? null
            : parseLocalizedVsTotal(rightScore, locale);
      } catch {
        setError(t("capture.invalid"));
        return null;
      }
      return {
        ...base,
        kind,
        day,
        leftScore: parsedLeft,
        rightScore: parsedRight,
        finalDay,
      };
    }
    return {
      ...base,
      kind,
      leftPoints: points(leftPoints),
      rightPoints: points(rightPoints),
      dayResults: winners.map((winner, index) => ({
        day: index + 1,
        winner,
      })),
    };
  }

  function expectedVersions(): {
    expectedMatchupVersion: number;
    expectedDayVersions: Record<string, number>;
  } {
    const matchup: VsMatchupView | null = effective?.matchup ?? null;
    const dayVersions: Record<string, number> = {};
    const dates = vsDatesForWeek(weekStart);
    if (kind === "daily_totals") {
      if (finalDay && day != null) {
        const date = dates[day - 1]!;
        dayVersions[date] = matchup?.days.find((d) => d.recordedDate === date)?.version ?? 0;
      }
    } else {
      winners.forEach((winner, index) => {
        if (winner === "unknown") return;
        const date = dates[index]!;
        dayVersions[date] = matchup?.days.find((d) => d.recordedDate === date)?.version ?? 0;
      });
    }
    return {
      expectedMatchupVersion: matchup?.version ?? 0,
      expectedDayVersions: dayVersions,
    };
  }

  async function save() {
    if (busy || !staged || !confirmSides || !effective) return;
    const review = buildReview();
    if (!review) return;
    const versions = expectedVersions();
    const scope = payload.contextScope;
    const requestBody = JSON.stringify({
      review,
      ...versions,
      scope: effective.scope,
    });
    if (requestRef.current?.body !== requestBody) {
      requestRef.current = { id: crypto.randomUUID(), body: requestBody };
    }
    const requestId = requestRef.current.id;
    const seq = ++saveSeq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/vs-performance/captures/${encodeURIComponent(staged.reviewId)}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            review,
            expectedReviewVersion: staged.version,
            ...versions,
            requestId,
            scope: effective.scope,
          }),
        },
      );
      const body = (await res.json()) as VsWeekPayload & ApiError;
      if (seq !== saveSeq.current || prevScope.current !== scope) return;
      if (!res.ok) {
        setError(t(`capture.${captureErrorKey(body)}`));
        return;
      }
      if (body.contextScope !== scope) return;
      reset();
      onOpenChange(false);
      if (body.weekStart === payload.weekStart) {
        onSaved(body);
      } else {
        const params = new URLSearchParams(searchParams.toString());
        params.set("week", body.weekStart);
        router.push(`${pathname}?${params.toString()}`);
      }
    } catch {
      if (seq === saveSeq.current && prevScope.current === scope) setError(t("capture.invalid"));
    } finally {
      if (seq === saveSeq.current && prevScope.current === scope) setBusy(false);
    }
  }

  const candidate = staged?.candidate ?? null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
      title={t("capture.title")}
      ignoreOutsideDismiss={busy}
      data-testid="vs-capture-dialog"
    >
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto p-5">
        <h4 className="text-base font-semibold text-hq-fg">
          {t("capture.title")}
        </h4>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("capture.hint")}</p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-hq-fg-muted">
            {t("capture.type")}
            <select
              className={`ml-2 ${inputCls}`}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as VsCaptureKind);
                setStaged(null);
                setConfirmSides(false);
                setFinalDay(false);
                setDay(null);
                requestRef.current = null;
              }}
              disabled={busy}
              data-testid="vs-capture-kind"
            >
              <option value="weekly_overview">{t("capture.weekType")}</option>
              <option value="daily_totals">{t("capture.dayType")}</option>
            </select>
          </label>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            disabled={busy}
            className="text-xs text-hq-fg-muted"
            data-testid="vs-capture-file"
          />
        </div>
        <p className="mt-1 text-xs text-hq-fg-muted">{t("capture.imageHint")}</p>

        {stage ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block"
              aria-label={t("capture.title")}
            >
              <Image
                src={stage.previewUrl}
                alt=""
                width={640}
                height={360}
                unoptimized
                className="max-h-64 w-auto cursor-zoom-in rounded-lg border border-hq-border object-contain"
              />
            </button>
          </div>
        ) : null}

        {!staged ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void parse()}
              disabled={busy || !stage}
              className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
              data-testid="vs-capture-read"
            >
              {busy ? t("capture.reading") : t("capture.read")}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-border disabled:opacity-50"
            >
              {t("actions.cancel")}
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-3" data-testid="vs-capture-review">
            {candidate?.partial ? (
              <p className="text-xs text-hq-accent" role="status">
                {t("capture.partial")}
              </p>
            ) : null}
            {candidate?.ongoing ? (
              <p className="text-xs text-hq-fg-muted" role="status">
                {t("capture.ongoing")}
              </p>
            ) : null}

            <label className="block text-xs text-hq-fg-muted">
              {t("capture.week")}
              <input
                type="date"
                className={`ml-2 ${inputCls}`}
                value={weekStart}
                onChange={(e) => {
                  setWeekStart(e.target.value);
                  setConfirmSides(false);
                  setFinalDay(false);
                  requestRef.current = null;
                }}
                disabled={busy}
                data-testid="vs-capture-week"
              />
            </label>

            {(["left", "right"] as const).map((side) => {
              const info = side === "left" ? left : right;
              const setInfo = side === "left" ? setLeft : setRight;
              return (
                <fieldset
                  key={side}
                  className="rounded-lg border border-hq-border p-2"
                >
                  <legend className="px-1 text-xs font-medium text-hq-fg">
                    {t(`capture.${side}`)}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    <input
                      className={`w-24 ${inputCls}`}
                      value={info.tag ?? ""}
                      onChange={(e) =>
                        setInfo({ ...info, tag: e.target.value || null })
                      }
                      placeholder={t("matchup.opponentTag")}
                      aria-label={`${t(`capture.${side}`)} ${t("matchup.opponentTag")}`}
                      disabled={busy}
                    />
                    <input
                      className={`flex-1 ${inputCls}`}
                      value={info.name ?? ""}
                      onChange={(e) =>
                        setInfo({ ...info, name: e.target.value || null })
                      }
                      placeholder={t("matchup.opponentName")}
                      aria-label={`${t(`capture.${side}`)} ${t("matchup.opponentName")}`}
                      disabled={busy}
                    />
                    <input
                      className={`w-24 ${inputCls}`}
                      value={info.server != null ? String(info.server) : ""}
                      inputMode="numeric"
                      onChange={(e) =>
                        setInfo({
                          ...info,
                          server:
                            e.target.value.trim() === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                      placeholder={t("matchup.opponentServer")}
                      aria-label={`${t(`capture.${side}`)} ${t("matchup.opponentServer")}`}
                      disabled={busy}
                    />
                  </div>
                </fieldset>
              );
            })}

            <label className="flex items-center gap-2 text-xs text-hq-fg">
              {t("capture.ourSide")}
              <select
                className={inputCls}
                value={ourSide}
                onChange={(e) => {
                  setOurSide(e.target.value as "left" | "right");
                  setConfirmSides(false);
                  setFinalDay(false);
                  requestRef.current = null;
                }}
                disabled={busy}
                data-testid="vs-capture-ourside"
              >
                <option value="left">{t("capture.left")}</option>
                <option value="right">{t("capture.right")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-hq-fg">
              <input
                type="checkbox"
                checked={confirmSides}
                onChange={(e) => setConfirmSides(e.target.checked)}
                disabled={busy}
                data-testid="vs-capture-confirm-sides"
              />
              {t("capture.confirmSides")}
            </label>

            {kind === "daily_totals" ? (
              <>
                <label className="flex items-center gap-2 text-xs text-hq-fg">
                  {day != null ? t("matchup.day", { day }) : null}
                  <select
                    className={inputCls}
                    value={day ?? ""}
                    onChange={(e) => {
                      setDay(
                        e.target.value === "" ? null : Number(e.target.value),
                      );
                      setFinalDay(false);
                      requestRef.current = null;
                    }}
                    disabled={busy}
                    data-testid="vs-capture-day"
                  >
                    <option value="" disabled>
                      {t("capture.unknown")}
                    </option>
                    {[1, 2, 3, 4, 5, 6].map((value) => (
                      <option key={value} value={value}>
                        {t("matchup.day", { day: value })}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={`w-40 ${inputCls}`}
                    value={leftScore}
                    inputMode="numeric"
                    onChange={(e) => setLeftScore(e.target.value)}
                    placeholder={t("capture.left")}
                    aria-label={t("capture.left")}
                    disabled={busy}
                    data-testid="vs-capture-left-score"
                  />
                  <input
                    className={`w-40 ${inputCls}`}
                    value={rightScore}
                    inputMode="numeric"
                    onChange={(e) => setRightScore(e.target.value)}
                    placeholder={t("capture.right")}
                    aria-label={t("capture.right")}
                    disabled={busy}
                    data-testid="vs-capture-right-score"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-hq-fg">
                  <input
                    type="checkbox"
                    checked={finalDay}
                    onChange={(e) => setFinalDay(e.target.checked)}
                    disabled={busy}
                    data-testid="vs-capture-finalday"
                  />
                  {t("capture.finalDay")}
                </label>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <label className="text-xs text-hq-fg-muted">
                    {t("capture.ourPoints")}
                    <input
                      className={`ml-2 w-16 ${inputCls}`}
                      value={
                        ourSide === "left" ? leftPoints : rightPoints
                      }
                      inputMode="numeric"
                      onChange={(e) =>
                        (ourSide === "left" ? setLeftPoints : setRightPoints)(
                          e.target.value,
                        )
                      }
                      disabled={busy}
                      data-testid="vs-capture-our-points"
                    />
                  </label>
                  <label className="text-xs text-hq-fg-muted">
                    {t("capture.opponentPoints")}
                    <input
                      className={`ml-2 w-16 ${inputCls}`}
                      value={
                        ourSide === "left" ? rightPoints : leftPoints
                      }
                      inputMode="numeric"
                      onChange={(e) =>
                        (ourSide === "left" ? setRightPoints : setLeftPoints)(
                          e.target.value,
                        )
                      }
                      disabled={busy}
                      data-testid="vs-capture-opponent-points"
                    />
                  </label>
                </div>
                <ol className="space-y-1">
                  {winners.map((winner, index) => (
                    <li
                      key={index}
                      className="flex items-center gap-2 text-xs text-hq-fg"
                    >
                      <span className="w-16">
                        {t("matchup.day", { day: index + 1 })}
                      </span>
                      <select
                        className={inputCls}
                        value={winner}
                        onChange={(e) =>
                          setWinners(
                            winners.map((value, i) =>
                              i === index
                                ? (e.target.value as "left" | "right" | "unknown")
                                : value,
                            ),
                          )
                        }
                        disabled={busy}
                        data-testid={`vs-capture-winner-${index + 1}`}
                      >
                        <option value="unknown">{t("capture.unknown")}</option>
                        <option value="left">{t("capture.left")}</option>
                        <option value="right">{t("capture.right")}</option>
                      </select>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void save()}
                disabled={
                  busy ||
                  !confirmSides ||
                  !effective ||
                  (kind === "daily_totals" && day == null)
                }
                className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
                data-testid="vs-capture-save"
              >
                {busy ? t("actions.saving") : t("capture.save")}
              </button>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-border disabled:opacity-50"
              >
                {t("actions.cancel")}
              </button>
            </div>
          </div>
        )}

        {error ? (
          <p ref={errorAnchor} className="mt-3 text-sm text-hq-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <ScreenshotLightbox
        open={lightboxOpen}
        index={0}
        slides={stage ? [{ src: stage.previewUrl }] : []}
        onClose={() => setLightboxOpen(false)}
        closeLabel={t("actions.cancel")}
      />
    </Dialog>
  );
}
