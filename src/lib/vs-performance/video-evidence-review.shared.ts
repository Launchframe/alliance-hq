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

function opponentNameKey(value: string | null): string | null {
  const name = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return name === "" ? null : name;
}

function opponentTagKey(value: string | null): string | null {
  if (value == null) return null;
  const tag = normalizedVsCaptureTag(value);
  return tag === "" ? null : tag;
}

/** Same-tag history rows merge when they never disagree on a filled name or server. */
function mergeOpponentGroup(rows: readonly VsCaptureAlliance[]): VsCaptureAlliance | null {
  let server: number | null = null;
  let name: string | null = null;
  let tag: string | null = null;
  for (const row of rows) {
    if (tag == null && row.tag?.trim()) tag = row.tag;
    if (row.server != null) {
      if (server != null && server !== row.server) return null;
      server = row.server;
    }
    const rowName = row.name?.trim() || null;
    if (rowName) {
      if (name != null && opponentNameKey(name) !== opponentNameKey(rowName)) return null;
      if (name == null || rowName.length > name.length) name = rowName;
    }
  }
  if (tag == null && name == null && server == null) return null;
  return { server, tag, name };
}

export function consolidateKnownVsOpponents(rows: readonly VsCaptureAlliance[]): VsCaptureAlliance[] {
  const groups = new Map<string, VsCaptureAlliance[]>();
  const untagged: VsCaptureAlliance[] = [];
  for (const row of rows) {
    const tag = opponentTagKey(row.tag);
    if (!tag) {
      untagged.push(row);
      continue;
    }
    const list = groups.get(tag) ?? [];
    list.push(row);
    groups.set(tag, list);
  }
  const out: VsCaptureAlliance[] = [];
  for (const list of groups.values()) {
    const merged = mergeOpponentGroup(list);
    if (merged) out.push(merged);
    else out.push(...list);
  }
  out.push(...untagged);
  return out;
}

export function matchKnownVsOpponent(
  parsed: VsCaptureAlliance,
  known: readonly VsCaptureAlliance[],
): VsCaptureAlliance | null {
  const pool = consolidateKnownVsOpponents(known);
  const tag = opponentTagKey(parsed.tag);
  const name = opponentNameKey(parsed.name);
  if (tag) {
    const byTag = pool.filter((row) => opponentTagKey(row.tag) === tag);
    if (byTag.length === 1) return byTag[0] ?? null;
    if (byTag.length > 1) {
      const narrowed = byTag.filter(
        (row) =>
          (parsed.server != null && row.server === parsed.server) ||
          (name != null && opponentNameKey(row.name) === name),
      );
      return narrowed.length === 1 ? narrowed[0] ?? null : null;
    }
  }
  if (name) {
    const byName = pool.filter((row) => opponentNameKey(row.name) === name);
    const narrowed =
      parsed.server == null
        ? byName
        : byName.filter((row) => row.server == null || row.server === parsed.server);
    return narrowed.length === 1 ? narrowed[0] ?? null : null;
  }
  return null;
}

export function mergeKnownVsOpponent(
  parsed: VsCaptureAlliance,
  known: VsCaptureAlliance,
): VsCaptureAlliance {
  return {
    tag: parsed.tag?.trim() ? parsed.tag : known.tag,
    name: parsed.name?.trim() ? parsed.name : known.name,
    server: parsed.server ?? known.server,
  };
}

function withAllianceIdentity(
  side: VsCaptureAlliance,
  alliance: VsVideoEvidenceResponse["alliance"],
): VsCaptureAlliance {
  const next = { ...side };
  if (next.tag == null && alliance.tag) next.tag = alliance.tag;
  if (next.name == null && alliance.name) next.name = alliance.name;
  if (next.server == null && alliance.server != null && alliance.server > 0) {
    next.server = alliance.server;
  }
  return next;
}

export function seedVsVideoDraftForm(response: VsVideoEvidenceResponse): VsVideoDraftForm {
  const candidate = response.evidence.status === "ready" ? response.evidence.candidate : null;
  const tag = response.alliance.tag ? normalizedVsCaptureTag(response.alliance.tag) : null;
  const leftMatches = tag !== null && candidate?.left.tag != null && normalizedVsCaptureTag(candidate.left.tag) === tag;
  const rightMatches = tag !== null && candidate?.right.tag != null && normalizedVsCaptureTag(candidate.right.tag) === tag;
  const detectedSide = leftMatches !== rightMatches ? (leftMatches ? "left" : "right") : null;
  const ourSide = candidate ? (detectedSide ?? "left") : null;
  const left = candidate ? { ...candidate.left } : blankAlliance();
  const right = candidate ? { ...candidate.right } : blankAlliance();
  if (ourSide === "left") Object.assign(left, withAllianceIdentity(left, response.alliance));
  if (ourSide === "right") Object.assign(right, withAllianceIdentity(right, response.alliance));
  const finalDay = candidate?.kind === "daily_totals" && vsVideoFinalDayAvailable(response) && candidate.ongoing !== true;
  return {
    source: candidate ? "screenshot" : "manual", kind: candidate?.kind ?? null,
    basisImageVersion: response.evidence.imageVersion, editOpponent: false,
    opponent: hasVsVideoOpponent(response) ? savedOpponent(response) : ourSide ? { ...(ourSide === "left" ? right : left) } : blankAlliance(),
    opponentScore: "", ourSide, confirmSides: ourSide !== null, finalDay,
    day: candidate?.day ?? null, left, right,
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
    ...form, [side]: own, opponent, ourSide: side, confirmSides: true,
    dirtyFields: [...new Set([...form.dirtyFields, side, "opponent" as const, "ourSide" as const, "confirmSides" as const])],
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

/** Screenshot review cannot be committed until OCR has a ready candidate. Video score save must continue without it. */
export function vsVideoScreenshotMatchPending(response: VsVideoEvidenceResponse, form: VsVideoDraftForm): boolean {
  return form.source === "screenshot" && (response.evidence.status !== "ready" || response.evidence.candidate == null);
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
