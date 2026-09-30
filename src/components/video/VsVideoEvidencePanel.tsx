"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";
import { AppSelect } from "@/components/ui/AppSelect";
import { Dialog } from "@/components/ui/dialog";
import type { useVsVideoEvidence } from "@/components/video/useVsVideoEvidence";
import type { VsCaptureAlliance } from "@/lib/vs-performance/vs-capture.shared";
import type { VsVideoRequestedKind } from "@/lib/vs-performance/video-evidence.shared";
import { vsVideoWeekStart } from "@/lib/vs-performance/video-evidence.shared";
import { hasVsVideoOpponent } from "@/lib/vs-performance/video-evidence-review.shared";
import { vsPerformanceDayNumberForDate } from "@/lib/video/vs-recorded-date.shared";

type Controller = ReturnType<typeof useVsVideoEvidence>;

const inputCls =
  "rounded-md border border-hq-border bg-hq-surface px-2 py-1 text-sm text-hq-fg disabled:opacity-50";

type PendingReset =
  | { kind: "remove" }
  | { kind: "requestedKind"; value: VsVideoRequestedKind }
  | { kind: "upload"; file: File };

function opponentIdentity(a: VsCaptureAlliance): string {
  return [a.tag, a.name, a.server != null ? String(a.server) : null]
    .filter((part) => part != null && part !== "")
    .join(" · ");
}

function parseServerInput(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

export function VsVideoEvidencePanel(props: {
  controller: Controller;
  jobStatus: string;
  submitting?: boolean;
}) {
  const { controller, jobStatus } = props;
  const submitting = Boolean(props.submitting);
  const t = useTranslations("vsPerformance");
  const tv = useTranslations("vsPerformance.videoEvidence");
  const tReview = useTranslations("videoReview");
  const tErrors = useTranslations("httpErrors");
  const tc = useTranslations("common");
  const tNav = useTranslations("nav");
  const fileRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [pendingReset, setPendingReset] = useState<PendingReset | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previousOpponents, setPreviousOpponents] = useState<
    Array<{ server: number | null; tag: string | null; name: string | null }>
  >([]);
  const opponentsFetchedRef = useRef(false);
  const [matchRequestId, setMatchRequestId] = useState<{
    id: string;
    body: string;
  } | null>(null);

  const state = controller.state;
  const form = controller.form;
  const evidence = state?.evidence ?? null;

  useEffect(() => {
    if (!state?.canEditMatch || opponentsFetchedRef.current) return;
    opponentsFetchedRef.current = true;
    void fetch("/api/vs-performance/matchup/opponents")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { opponents?: typeof previousOpponents } | null) => {
        if (Array.isArray(data?.opponents)) {
          setPreviousOpponents(data.opponents);
        }
      })
      .catch(() => undefined);
  }, [state?.canEditMatch]);

  const errorMessage = errorText(controller.errorCode);
  useEffect(() => {
    if (errorMessage) {
      errorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [errorMessage]);

  const requestReset = useCallback((next: PendingReset) => {
    setPendingReset(next);
  }, []);

  const confirmReset = useCallback(() => {
    const pending = pendingReset;
    setPendingReset(null);
    if (!pending) return;
    if (pending.kind === "remove") {
      void controller.remove();
    } else if (pending.kind === "requestedKind") {
      void controller.changeKind(pending.value);
    } else {
      void controller.upload(pending.file);
    }
  }, [controller, pendingReset]);

  function errorText(code: string | null): string | null {
    if (!code) return null;
    if (code === "stale") return tv("stale");
    if (code === "forbidden") return t("errors.forbidden");
    if (code === "context_mismatch") return tv("contextMismatch");
    if (code === "identity_mismatch") return tv("identityMismatch");
    if (code === "capture_invalid" || code === "invalid") {
      return t("capture.invalid");
    }
    if (code === "capture_point_mismatch") return t("capture.pointMismatch");
    if (code === "not_found") return tErrors("notFoundTitle");
    if (code === "network" || code === "attach_failed") {
      return tErrors("serverErrorTitle");
    }
    return tv("attachFailed");
  }

  const controlsDisabled = controller.busy || submitting;

  if (!state || !evidence || !form) {
    if (!controller.loaded) {
      return <p className="text-xs text-hq-fg-muted">{tc("loading")}</p>;
    }
    if (!state && controller.errorCode) {
      return (
        <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
          <p className="text-sm text-hq-danger" role="alert" ref={errorRef}>
            {errorMessage ?? tErrors("serverErrorTitle")}{" "}
            <button
              type="button"
              className="text-hq-accent underline"
              onClick={() => void controller.reload()}
            >
              {tErrors("tryAgain")}
            </button>
          </p>
        </div>
      );
    }
    return null;
  }

  const canEdit = state.canEditMatch;
  const canAttach = state.canAttach;
  const hasImage = evidence.fileName != null;
  const candidate = evidence.candidate;
  const kind =
    candidate?.kind ??
    (evidence.requestedKind === "auto" ? null : evidence.requestedKind);
  const ourSide = form.ourSide;
  const foeSide =
    ourSide === "left" ? "right" : ourSide === "right" ? "left" : null;
  const savedOpponent = hasVsVideoOpponent(state);
  const opponentEditing =
    !savedOpponent || form.editOpponent || form.dirtyFields.includes("opponent");
  const showOpponentScore =
    evidence.period === "daily" && kind !== "daily_totals";
  const manualFoeScore =
    evidence.period === "daily" && kind === "daily_totals";
  const finalDayAllowed =
    evidence.period === "daily" && evidence.recordedDate < state.today;
  const expectedDay =
    evidence.period === "daily"
      ? vsPerformanceDayNumberForDate(evidence.recordedDate)
      : null;
  const reviewedDayMismatch =
    kind === "daily_totals" &&
    form.day != null &&
    expectedDay != null &&
    form.day !== expectedDay;
  const showContextMismatch = !controller.contextMatches || reviewedDayMismatch;

  function allianceInputs(
    side: "left" | "right",
    value: VsCaptureAlliance,
    editable: boolean,
  ) {
    return (
      <div className="flex flex-wrap gap-2">
        <input
          className={`w-24 ${inputCls}`}
          value={value.tag ?? ""}
          onChange={(event) =>
            controller.setField(side, { tag: event.target.value || null })
          }
          placeholder={tReview("opponentTagLabel")}
          aria-label={`${t(`capture.${side}`)} ${tReview("opponentTagLabel")}`}
          disabled={!editable || controlsDisabled}
        />
        <input
          className={`flex-1 ${inputCls}`}
          value={value.name ?? ""}
          onChange={(event) =>
            controller.setField(side, { name: event.target.value || null })
          }
          placeholder={tReview("opponentNameLabel")}
          aria-label={`${t(`capture.${side}`)} ${tReview("opponentNameLabel")}`}
          disabled={!editable || controlsDisabled}
        />
        <input
          className={`w-24 ${inputCls}`}
          value={value.server != null ? String(value.server) : ""}
          inputMode="numeric"
          onChange={(event) => {
            const parsed = parseServerInput(event.target.value);
            if (parsed === undefined) return;
            controller.setField(side, { server: parsed });
          }}
          placeholder={tReview("opponentServerLabel")}
          aria-label={`${t(`capture.${side}`)} ${tReview("opponentServerLabel")}`}
          disabled={!editable || controlsDisabled}
        />
      </div>
    );
  }

  async function saveMatchOnly() {
    try {
      const submission = await controller.prepareSubmission({
        forceInclude: true,
      });
      if (!submission) return;
      const body = JSON.stringify(submission);
      const request =
        matchRequestId && matchRequestId.body === body
          ? matchRequestId
          : { id: crypto.randomUUID(), body };
      setMatchRequestId(request);
      await controller.saveMatch(request.id, submission);
    } catch {
      setPendingReset(null);
    }
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4"
      data-testid="vs-video-evidence-panel"
    >
      <p className="text-sm text-hq-fg-muted">{t("capture.hint")}</p>

      {!canEdit ? (
        <p className="text-xs text-hq-fg-muted">{tv("officerOnly")}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {evidence.previewUrl ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="rounded-lg border border-hq-border p-0.5"
            aria-label={tv("previewAlt")}
          >
            <Image
              src={evidence.previewUrl}
              alt={tv("previewAlt")}
              width={160}
              height={90}
              unoptimized
              className="max-h-24 w-auto rounded-md object-contain"
            />
          </button>
        ) : null}
        {canAttach ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              aria-label={tv("attachmentLabel")}
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                event.target.value = "";
                if (!next) return;
                if (hasImage) requestReset({ kind: "upload", file: next });
                else void controller.upload(next);
              }}
            />
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
            >
              {hasImage ? tv("replaceScreenshot") : tv("addScreenshot")}
            </button>
            {hasImage ? (
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => requestReset({ kind: "remove" })}
                className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-danger hover:bg-hq-surface-muted disabled:opacity-50"
              >
                {tv("removeScreenshot")}
              </button>
            ) : null}
            {hasImage ? (
              <AppSelect
                value={evidence.requestedKind}
                onChange={(next) => {
                  const requested = next as VsVideoRequestedKind;
                  if (requested === evidence.requestedKind) return;
                  requestReset({ kind: "requestedKind", value: requested });
                }}
                aria-label={t("capture.type")}
                options={[
                  { value: "auto", label: tv("detectAutomatically") },
                  {
                    value: "daily_totals",
                    label: t("capture.dayType"),
                  },
                  {
                    value: "weekly_overview",
                    label: t("capture.weekType"),
                  },
                ]}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {candidate?.kind ? (
        <p className="text-xs text-hq-fg-muted">
          {tv("detectedType", {
            type: t(
              candidate.kind === "daily_totals"
                ? "capture.dayType"
                : "capture.weekType",
            ),
          })}
        </p>
      ) : null}
      {evidence.status === "needs_type" ? (
        <p className="text-xs text-hq-accent">{tv("chooseType")}</p>
      ) : null}
      {evidence.status === "queued" || evidence.status === "running" ? (
        <p className="text-xs text-hq-fg-muted" role="status">
          {tv("queued")} {tv("processingHint")}
        </p>
      ) : null}
      {evidence.status === "ready" ? (
        <p className="text-xs text-hq-success" role="status">
          {tv("ready")}
        </p>
      ) : null}
      {evidence.status === "failed" ? (
        <p className="text-xs text-hq-danger" role="alert">
          {t("capture.failed")}{" "}
          {state.canProcessImage ? (
            <button
              type="button"
              className="text-hq-accent underline"
              onClick={() => void controller.retryProcessing()}
            >
              {t("actions.retry")}
            </button>
          ) : null}
        </p>
      ) : null}
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
      {kind === "weekly_overview" && hasImage ? (
        <p className="text-xs text-hq-fg-muted">{tv("weeklyOnly")}</p>
      ) : null}
      {kind === "daily_totals" && hasImage && !finalDayAllowed ? (
        <p className="text-xs text-hq-fg-muted">{t("capture.noFinals")}</p>
      ) : null}
      {showOpponentScore && form.opponentScore.trim() !== "" && !hasImage ? (
        <p className="text-xs text-hq-fg-muted">
          {t("matchup.opponentOnlyHint")}
        </p>
      ) : null}
      {showContextMismatch ? (
        <p className="text-xs text-hq-danger" role="alert">
          {tv("contextMismatch")}
        </p>
      ) : null}

      <div className="rounded-lg border border-hq-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-hq-fg">
            {tv("opponentInfo")}
          </h4>
          {savedOpponent && canEdit && !opponentEditing ? (
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => controller.setField("editOpponent", true)}
              className="text-xs text-hq-accent hover:underline disabled:opacity-50"
            >
              {tv("editIdentity")}
            </button>
          ) : null}
        </div>
        {savedOpponent && !opponentEditing ? (
          <p className="mt-1 text-xs text-hq-fg-muted">
            {tv("identitySaved")}{" "}
            {state.matchup
              ? opponentIdentity({
                  server: state.matchup.opponentServer,
                  tag: state.matchup.opponentTag,
                  name: state.matchup.opponentName,
                })
              : null}
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {previousOpponents.length > 0 && canEdit ? (
              <AppSelect
                value=""
                onChange={(next) => {
                  const selected = previousOpponents[Number(next)];
                  if (!selected) return;
                  controller.setField("editOpponent", true);
                  controller.setField("opponent", selected);
                }}
                placeholder={t("matchup.selectPrevious")}
                aria-label={t("matchup.previousOpponents")}
                options={previousOpponents.map((opponent, index) => ({
                  value: String(index),
                  label: opponentIdentity(opponent),
                }))}
              />
            ) : null}
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <input
                  className={`w-24 ${inputCls}`}
                  value={form.opponent.tag ?? ""}
                  onChange={(event) =>
                    controller.setField("opponent", {
                      tag: event.target.value || null,
                    })
                  }
                  placeholder={t("matchup.opponentTag")}
                  aria-label={t("matchup.opponentTag")}
                  disabled={controlsDisabled}
                />
                <input
                  className={`flex-1 ${inputCls}`}
                  value={form.opponent.name ?? ""}
                  onChange={(event) =>
                    controller.setField("opponent", {
                      name: event.target.value || null,
                    })
                  }
                  placeholder={t("matchup.opponentName")}
                  aria-label={t("matchup.opponentName")}
                  disabled={controlsDisabled}
                />
                <input
                  className={`w-24 ${inputCls}`}
                  value={
                    form.opponent.server != null
                      ? String(form.opponent.server)
                      : ""
                  }
                  inputMode="numeric"
                  onChange={(event) => {
                    const parsed = parseServerInput(event.target.value);
                    if (parsed === undefined) return;
                    controller.setField("opponent", { server: parsed });
                  }}
                  placeholder={t("matchup.opponentServer")}
                  aria-label={t("matchup.opponentServer")}
                  disabled={controlsDisabled}
                />
              </div>
            ) : (
              <p className="text-xs text-hq-fg-muted">
                {t("matchup.unknown")}
              </p>
            )}
          </div>
        )}
        {showOpponentScore ? (
          <label className="mt-2 block text-xs text-hq-fg-muted">
            {t("matchup.opponentScore")}
            <input
              className={`ml-2 w-40 ${inputCls}`}
              value={form.opponentScore}
              inputMode="numeric"
              onChange={(event) =>
                controller.setField("opponentScore", event.target.value)
              }
              aria-label={t("matchup.opponentScore")}
              disabled={!canEdit || controlsDisabled}
            />
          </label>
        ) : null}
        {manualFoeScore && foeSide ? (
          <label className="mt-2 block text-xs text-hq-fg-muted">
            {t("matchup.opponentScore")}
            <input
              className={`ml-2 w-40 ${inputCls}`}
              value={foeSide === "left" ? form.leftScore : form.rightScore}
              inputMode="numeric"
              onChange={(event) =>
                controller.setField(
                  foeSide === "left" ? "leftScore" : "rightScore",
                  event.target.value,
                )
              }
              aria-label={t("matchup.opponentScore")}
              disabled={!canEdit || controlsDisabled}
            />
          </label>
        ) : null}
      </div>

      {hasImage || form.source === "manual" ? (
        <div className="space-y-3" data-testid="vs-video-evidence-review">
          {hasImage ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["left", "right"] as const).map((side) => {
                  const isOwn = ourSide === side;
                  return (
                    <fieldset
                      key={side}
                      className="rounded-lg border border-hq-border p-2"
                    >
                      <legend className="px-1 text-xs font-medium text-hq-fg">
                        {t(`capture.${side}`)}
                      </legend>
                      {allianceInputs(side, form[side], canEdit && isOwn)}
                    </fieldset>
                  );
                })}
              </div>
              <label className="flex items-center gap-2 text-xs text-hq-fg">
                {t("capture.ourSide")}
                <select
                  className={inputCls}
                  value={ourSide ?? ""}
                  onChange={(event) => {
                    const side = event.target.value;
                    if (side === "left" || side === "right") {
                      controller.chooseSide(side);
                    }
                  }}
                  disabled={!canEdit || controlsDisabled}
                  data-testid="vs-video-ourside"
                >
                  <option value="" disabled>
                    {t("capture.unknown")}
                  </option>
                  <option value="left">{t("capture.left")}</option>
                  <option value="right">{t("capture.right")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-hq-fg">
                <input
                  type="checkbox"
                  checked={form.confirmSides}
                  onChange={(event) =>
                    controller.setField("confirmSides", event.target.checked)
                  }
                  disabled={!canEdit || controlsDisabled}
                  data-testid="vs-video-confirm-sides"
                />
                {t("capture.confirmSides")}
              </label>
            </>
          ) : null}

          {kind === "daily_totals" && hasImage ? (
            <>
              <label className="flex items-center gap-2 text-xs text-hq-fg">
                {form.day != null ? t("matchup.day", { day: form.day }) : null}
                <select
                  className={inputCls}
                  value={form.day ?? ""}
                  onChange={(event) =>
                    controller.setField(
                      "day",
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                    )
                  }
                  disabled={!canEdit || controlsDisabled}
                  data-testid="vs-video-day"
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
              {ourSide ? (
                <label className="block text-xs text-hq-fg-muted">
                  {t("results.ourTotal")}
                  <input
                    className={`ml-2 w-40 ${inputCls}`}
                    value={
                      ourSide === "left" ? form.leftScore : form.rightScore
                    }
                    inputMode="numeric"
                    onChange={(event) =>
                      controller.setField(
                        ourSide === "left" ? "leftScore" : "rightScore",
                        event.target.value,
                      )
                    }
                    aria-label={t("results.ourTotal")}
                    disabled={!canEdit || controlsDisabled}
                  />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-hq-fg">
                <input
                  type="checkbox"
                  checked={form.finalDay}
                  onChange={(event) =>
                    controller.setField("finalDay", event.target.checked)
                  }
                  disabled={!canEdit || !finalDayAllowed || controlsDisabled}
                  data-testid="vs-video-finalday"
                />
                {t("capture.finalDay")}
              </label>
            </>
          ) : null}

          {kind === "weekly_overview" && hasImage ? (
            <>
              <div className="flex flex-wrap gap-2">
                {ourSide ? (
                  <>
                    <label className="text-xs text-hq-fg-muted">
                      {t("capture.ourPoints")}
                      <input
                        className={`ml-2 w-16 ${inputCls}`}
                        value={
                          ourSide === "right"
                            ? form.rightPoints
                            : form.leftPoints
                        }
                        inputMode="numeric"
                        onChange={(event) =>
                          controller.setField(
                            ourSide === "right" ? "rightPoints" : "leftPoints",
                            event.target.value,
                          )
                        }
                        disabled={!canEdit || controlsDisabled}
                        data-testid="vs-video-our-points"
                      />
                    </label>
                    <label className="text-xs text-hq-fg-muted">
                      {t("capture.opponentPoints")}
                      <input
                        className={`ml-2 w-16 ${inputCls}`}
                        value={
                          ourSide === "right"
                            ? form.leftPoints
                            : form.rightPoints
                        }
                        inputMode="numeric"
                        onChange={(event) =>
                          controller.setField(
                            ourSide === "right" ? "leftPoints" : "rightPoints",
                            event.target.value,
                          )
                        }
                        disabled={!canEdit || controlsDisabled}
                        data-testid="vs-video-opponent-points"
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="text-xs text-hq-fg-muted">
                      {t("capture.left")}
                      <input
                        className={`ml-2 w-16 ${inputCls}`}
                        value={form.leftPoints}
                        inputMode="numeric"
                        onChange={(event) =>
                          controller.setField("leftPoints", event.target.value)
                        }
                        disabled={!canEdit || controlsDisabled}
                        data-testid="vs-video-left-points"
                      />
                    </label>
                    <label className="text-xs text-hq-fg-muted">
                      {t("capture.right")}
                      <input
                        className={`ml-2 w-16 ${inputCls}`}
                        value={form.rightPoints}
                        inputMode="numeric"
                        onChange={(event) =>
                          controller.setField("rightPoints", event.target.value)
                        }
                        disabled={!canEdit || controlsDisabled}
                        data-testid="vs-video-right-points"
                      />
                    </label>
                  </>
                )}
              </div>
              <ol className="space-y-1">
                {form.winners.map((winner, index) => {
                  const dayDate = new Date(
                    Date.parse(`${vsVideoWeekStart(evidence)}T00:00:00Z`),
                  );
                  dayDate.setUTCDate(dayDate.getUTCDate() + index);
                  const recorded = dayDate.toISOString().slice(0, 10);
                  const dayClosed = recorded < state.today;
                  return (
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
                        onChange={(event) =>
                          controller.setField(
                            "winners",
                            form.winners.map((value, i) =>
                              i === index
                                ? (event.target.value as
                                    | "left"
                                    | "right"
                                    | "unknown")
                                : value,
                            ),
                          )
                        }
                        disabled={!canEdit || !dayClosed || controlsDisabled}
                        data-testid={`vs-video-winner-${index + 1}`}
                      >
                        <option value="unknown">
                          {t("capture.unknown")}
                        </option>
                        <option value="left">{t("capture.left")}</option>
                        <option value="right">{t("capture.right")}</option>
                      </select>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <label className="flex items-center gap-2 text-xs text-hq-fg">
          <input
            type="checkbox"
            checked={controller.includeResults}
            onChange={(event) =>
              controller.setIncludeResults(event.target.checked)
            }
            disabled={controlsDisabled}
            data-testid="vs-video-include-results"
          />
          {tv("includeResults")}
        </label>
      ) : null}

      {jobStatus === "complete" &&
      canEdit &&
      controller.hasUnappliedEvidence ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-hq-fg-muted">{tv("notApplied")}</p>
          <button
            type="button"
            disabled={
              controlsDisabled ||
              (form.source === "screenshot" && !form.confirmSides)
            }
            onClick={() => void saveMatchOnly()}
            className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white hover:bg-hq-success-hover disabled:opacity-50"
            data-testid="vs-video-save-match"
          >
            {controller.busy ? t("actions.saving") : t("capture.save")}
          </button>
          <button
            type="button"
            onClick={() => controller.cancelReview()}
            className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-surface-muted"
          >
            {t("actions.cancel")}
          </button>
        </div>
      ) : null}
      {controller.success ? (
        <p className="text-xs text-hq-success" role="status">
          {tv("matchSaved")}
        </p>
      ) : null}

      {state.ashedLinked ? (
        <div className="flex flex-wrap gap-4 text-xs text-hq-fg-muted">
          {state.scoreSync.status !== "idle" ? (
            <span>
              {tv("scoreSyncLabel")}:{" "}
              {state.scoreSync.status === "credentials_required" ? (
                <Link
                  href="/connect"
                  className="text-hq-accent hover:underline"
                >
                  {tc("connect")}
                </Link>
              ) : state.scoreSync.status === "local" ? null : (
                t(`ashedSync.${state.scoreSync.status}`)
              )}
              {state.scoreSync.status === "failed" &&
              state.canWriteScores ? (
                <button
                  type="button"
                  className="ml-1 text-hq-accent underline"
                  onClick={() => void controller.retrySync("scores")}
                >
                  {t("actions.retry")}
                </button>
              ) : null}
            </span>
          ) : null}
          {state.matchup && state.matchup.sync.status !== "idle" ? (
            <span>
              {tv("matchSyncLabel")}:{" "}
              {state.matchup.sync.status === "credentials_required" ? (
                <Link
                  href="/connect"
                  className="text-hq-accent hover:underline"
                >
                  {tc("connect")}
                </Link>
              ) : (
                t(`ashedSync.${state.matchup.sync.status}`)
              )}
              {state.matchup.sync.status === "failed" && canEdit ? (
                <button
                  type="button"
                  className="ml-1 text-hq-accent underline"
                  onClick={() => void controller.retrySync("matchup")}
                >
                  {t("actions.retry")}
                </button>
              ) : null}
              {state.matchup.conflicts.length > 0 ||
              state.matchup.sync.status === "conflict" ||
              state.matchup.sync.status === "uncertain" ? (
                <Link
                  href={`/vs-performance?week=${vsVideoWeekStart(evidence)}`}
                  className="ml-1 text-hq-accent hover:underline"
                >
                  {tNav("vsPerformance")}
                </Link>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <p className="text-sm text-hq-danger" role="alert" ref={errorRef}>
          {errorMessage}{" "}
          {controller.errorCode === "stale" ? (
            <button
              type="button"
              className="text-hq-accent underline"
              onClick={() => void controller.reload()}
            >
              {tv("reloadReview")}
            </button>
          ) : null}
        </p>
      ) : null}

      <Dialog
        open={pendingReset != null}
        onOpenChange={(open) => {
          if (!open) setPendingReset(null);
        }}
        title={tv("attachmentLabel")}
      >
        <div className="p-5">
          <p className="text-sm text-hq-fg">{tv("resetReview")}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={confirmReset}
              className="rounded-lg border border-hq-success bg-hq-success px-3 py-1.5 text-xs font-medium text-white"
            >
              {tc("next")}
            </button>
            <button
              type="button"
              onClick={() => setPendingReset(null)}
              className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-surface-muted"
            >
              {t("actions.cancel")}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={previewOpen && evidence.previewUrl != null}
        onOpenChange={setPreviewOpen}
        title={tv("previewAlt")}
      >
        <div className="p-5">
          {evidence.previewUrl ? (
            <Image
              src={evidence.previewUrl}
              alt={tv("previewAlt")}
              width={1200}
              height={800}
              unoptimized
              className="max-h-[70vh] w-auto max-w-full rounded-lg border border-hq-border object-contain"
            />
          ) : null}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="rounded-lg border border-hq-border px-3 py-1.5 text-xs text-hq-fg hover:bg-hq-surface-muted"
            >
              {t("actions.cancel")}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
