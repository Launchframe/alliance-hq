import { getServerCalendarDate } from "@/lib/trains/game-time";
import { parseLocalizedVsTotal } from "./match-results.shared";
import { normalizedVsCaptureTag, type VsCaptureAlliance, type VsCaptureReview } from "./vs-capture.shared";
import { VsPerformanceError, vsDatesForWeek } from "./weekly-plan.shared";
import { vsVideoMatchSubmissionSchema, vsVideoScreenshotContextMatches, vsVideoWeekStart, type VsVideoDraft, type VsVideoDraftForm, type VsVideoEvidenceResponse, type VsVideoMatchSubmission } from "./video-evidence.shared";

const blankAlliance = (): VsCaptureAlliance => ({ server: null, tag: null, name: null });

function savedOpponent(response: VsVideoEvidenceResponse): VsCaptureAlliance {
  return response.matchup ? { server: response.matchup.opponentServer, tag: response.matchup.opponentTag, name: response.matchup.opponentName } : blankAlliance();
}

export function hasVsVideoOpponent(response: VsVideoEvidenceResponse): boolean {
  const opponent = savedOpponent(response);
  return opponent.server !== null || opponent.tag !== null || opponent.name !== null;
}

export function seedVsVideoDraftForm(response: VsVideoEvidenceResponse): VsVideoDraftForm {
  const candidate = response.evidence.status === "ready" ? response.evidence.candidate : null;
  const tag = response.alliance.tag ? normalizedVsCaptureTag(response.alliance.tag) : null;
  const leftMatches = tag !== null && candidate?.left.tag != null && normalizedVsCaptureTag(candidate.left.tag) === tag;
  const rightMatches = tag !== null && candidate?.right.tag != null && normalizedVsCaptureTag(candidate.right.tag) === tag;
  const ourSide = leftMatches !== rightMatches ? leftMatches ? "left" : "right" : null;
  return {
    source: candidate ? "screenshot" : "manual", kind: candidate?.kind ?? null,
    basisImageVersion: response.evidence.imageVersion, editOpponent: false,
    opponent: hasVsVideoOpponent(response) ? savedOpponent(response) : candidate && ourSide ? { ...candidate[ourSide === "left" ? "right" : "left"] } : blankAlliance(),
    opponentScore: "", ourSide, confirmSides: false, finalDay: false,
    day: candidate?.day ?? null, left: candidate ? { ...candidate.left } : blankAlliance(), right: candidate ? { ...candidate.right } : blankAlliance(),
    leftScore: candidate?.leftScore ?? "", rightScore: candidate?.rightScore ?? "",
    leftPoints: candidate?.leftPoints == null ? "" : String(candidate.leftPoints), rightPoints: candidate?.rightPoints == null ? "" : String(candidate.rightPoints),
    winners: Array.from({ length: 6 }, (_, index) => candidate?.dayResults.find(day => day.day === index + 1)?.winner ?? "unknown"),
    expectedMatchupVersion: response.matchup?.version ?? 0,
    expectedDayVersions: Object.fromEntries(vsDatesForWeek(vsVideoWeekStart(response.evidence)).map(date => [date, response.matchup?.days.find(day => day.recordedDate === date)?.version ?? 0])),
    dirtyFields: [],
  };
}

export function mergeVsVideoCandidate(form: VsVideoDraftForm, response: VsVideoEvidenceResponse): VsVideoDraftForm {
  if (form.basisImageVersion !== response.evidence.imageVersion) return form;
  const incoming = seedVsVideoDraftForm(response);
  if (!response.evidence.candidate || response.evidence.status !== "ready") return form;
  const dirty = new Set(form.dirtyFields);
  const next = { ...form, source: "screenshot" as const, kind: incoming.kind, ...(dirty.size === 0 ? { expectedMatchupVersion: incoming.expectedMatchupVersion, expectedDayVersions: incoming.expectedDayVersions } : {}) };
  for (const key of ["left", "right", "leftScore", "rightScore", "leftPoints", "rightPoints", "day", "winners", "ourSide", "opponent"] as const) {
    if (!dirty.has(key)) Object.assign(next, { [key]: incoming[key] });
  }
  return next;
}

export function chooseVsVideoSide(form: VsVideoDraftForm, response: VsVideoEvidenceResponse, side: "left" | "right"): VsVideoDraftForm {
  const own = { ...form[side] };
  if (own.tag === null) own.tag = response.alliance.tag;
  if (own.server === null && response.alliance.server != null && response.alliance.server > 0) own.server = response.alliance.server;
  const opponent = !hasVsVideoOpponent(response) && !form.dirtyFields.includes("opponent") ? { ...form[side === "left" ? "right" : "left"] } : form.opponent;
  return {
    ...form, [side]: own, opponent, ourSide: side, confirmSides: false, finalDay: false,
    dirtyFields: [...new Set([...form.dirtyFields, side, "opponent" as const, "ourSide" as const, "confirmSides" as const, "finalDay" as const])],
  };
}

function optionalScore(value: string, locale: string): string | null {
  return value.trim() ? parseLocalizedVsTotal(value, locale) : null;
}

function points(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^(?:[0-9]|1[0-3])$/.test(value.trim())) throw new VsPerformanceError("capture_invalid", 400);
  return Number(value.trim());
}

export function buildVsVideoMatchSubmission(response: VsVideoEvidenceResponse, draft: VsVideoDraft, locale: string): VsVideoMatchSubmission | undefined {
  if (!draft.includeResults) return undefined;
  if (!response.canEditMatch) throw new VsPerformanceError("forbidden", 403);
  const form = draft.form;
  if (!form || response.evidence.version < 1) throw new VsPerformanceError("stale", 409);
  const base = { evidenceVersion: response.evidence.version, expectedMatchupVersion: form.expectedMatchupVersion, expectedDayVersions: form.expectedDayVersions, editOpponent: form.editOpponent };
  if (form.source === "manual") {
    const opponent: Partial<VsCaptureAlliance> = {};
    const saved = savedOpponent(response);
    for (const key of ["server", "tag", "name"] as const) {
      const value = form.opponent[key];
      if (value != null && value !== "" && value !== saved[key]) Object.assign(opponent, { [key]: value });
    }
    const opponentScore = optionalScore(form.opponentScore, locale);
    if (!Object.keys(opponent).length && opponentScore === null) return undefined;
    if (response.evidence.period !== "daily" && opponentScore !== null) throw new VsPerformanceError("context_mismatch", 400);
    return vsVideoMatchSubmissionSchema.parse({ ...base, data: { source: "manual", ...(Object.keys(opponent).length ? { opponent } : {}), ...(opponentScore === null ? {} : { opponentScore }) } });
  }
  if (response.evidence.status !== "ready" || !response.evidence.candidate || form.basisImageVersion !== response.evidence.imageVersion || form.kind !== response.evidence.candidate.kind) throw new VsPerformanceError("stale", 409);
  if (form.ourSide === null || !form.confirmSides) throw new VsPerformanceError("capture_invalid", 400);
  const own = form[form.ourSide];
  if (response.alliance.tag != null && (own.tag == null || normalizedVsCaptureTag(own.tag) !== normalizedVsCaptureTag(response.alliance.tag))) throw new VsPerformanceError("identity_mismatch", 400);
  if (response.alliance.server != null && own.server != null && own.server !== response.alliance.server) throw new VsPerformanceError("identity_mismatch", 400);
  const common = {
    weekStart: vsVideoWeekStart(response.evidence), ourSide: form.ourSide, confirmSides: true as const,
    left: form.ourSide === "left" ? own : form.opponent,
    right: form.ourSide === "right" ? own : form.opponent,
  };
  let review: VsCaptureReview;
  if (form.kind === "daily_totals") {
    if (form.day === null) throw new VsPerformanceError("capture_invalid", 400);
    review = { ...common, kind: "daily_totals", day: form.day, leftScore: optionalScore(form.leftScore, locale), rightScore: optionalScore(form.rightScore, locale), finalDay: form.finalDay };
  } else {
    review = { ...common, kind: "weekly_overview", leftPoints: points(form.leftPoints), rightPoints: points(form.rightPoints), dayResults: form.winners.map((winner, index) => ({ day: index + 1, winner })) };
  }
  if (!vsVideoScreenshotContextMatches(response.evidence, review)) throw new VsPerformanceError("context_mismatch", 400);
  const opponentScore = form.kind === "weekly_overview" ? optionalScore(form.opponentScore, locale) : null;
  if (opponentScore !== null && response.evidence.period !== "daily") throw new VsPerformanceError("context_mismatch", 400);
  return vsVideoMatchSubmissionSchema.parse({ ...base, data: { source: "screenshot", imageVersion: response.evidence.imageVersion, review, ...(opponentScore === null ? {} : { opponentScore }) } });
}

export function vsVideoScreenshotOwnTotal(response: VsVideoEvidenceResponse | null, form: VsVideoDraftForm | null, locale: string): { visible: boolean; total: string | null } {
  if (!response || !form || response.evidence.fileName === null || response.evidence.period !== "daily") return { visible: false, total: null };
  const kind = response.evidence.candidate?.kind ?? (response.evidence.requestedKind === "auto" ? null : response.evidence.requestedKind);
  if (kind !== "daily_totals") return { visible: false, total: null };
  if (response.evidence.status !== "ready" || form.basisImageVersion !== response.evidence.imageVersion || form.ourSide === null || !vsVideoScreenshotContextMatches(response.evidence, { kind, weekStart: vsVideoWeekStart(response.evidence), day: form.day })) return { visible: true, total: null };
  try { return { visible: true, total: optionalScore(form.ourSide === "left" ? form.leftScore : form.rightScore, locale) }; }
  catch { return { visible: true, total: null }; }
}

export function vsVideoFinalDayAvailable(response: VsVideoEvidenceResponse): boolean {
  return response.evidence.period === "daily" && response.evidence.recordedDate < (response.today || getServerCalendarDate());
}
