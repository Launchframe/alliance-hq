/**
 * Pure helpers for admin video-learning dashboard (fleet + thrash flags).
 */

export type LearningDirection = "improving" | "flat" | "regressing";

export type HygieneEventSnapshot = {
  kind: string;
  scoreTarget: string;
  createdAt: Date | string;
  payload: Record<string, unknown> | null;
};

export type ThrashFlagKind =
  | "adapt_oscillation"
  | "coach_spam"
  | "worsening_after_adapt"
  | "cross_signal_conflict";

export type ThrashFlag = {
  kind: ThrashFlagKind;
  hqUserId: string;
  scoreTarget: string;
  detail: string;
};

const ADAPT_OSCILLATION_MIN = 3;
const COACH_SPAM_MIN = 4;

export function learningDirectionFromWindows(params: {
  earlyThumbsUpRate: number | null;
  lateThumbsUpRate: number | null;
  earlyAvgQuality: number | null;
  lateAvgQuality: number | null;
}): LearningDirection {
  const deltas: number[] = [];
  if (
    params.earlyThumbsUpRate != null &&
    params.lateThumbsUpRate != null
  ) {
    deltas.push(params.lateThumbsUpRate - params.earlyThumbsUpRate);
  }
  if (params.earlyAvgQuality != null && params.lateAvgQuality != null) {
    deltas.push(params.lateAvgQuality - params.earlyAvgQuality);
  }
  if (deltas.length === 0) return "flat";
  const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  if (avg >= 0.05) return "improving";
  if (avg <= -0.05) return "regressing";
  return "flat";
}

function tipIdFromPayload(
  payload: Record<string, unknown> | null,
): string | null {
  if (!payload || typeof payload.tipId !== "string") return null;
  return payload.tipId;
}

/** Flag adapt bias flipping on/off repeatedly for the same user×target. */
export function detectAdaptOscillation(params: {
  hqUserId: string;
  events: HygieneEventSnapshot[];
}): ThrashFlag[] {
  const byTarget = new Map<string, HygieneEventSnapshot[]>();
  for (const event of params.events) {
    if (event.kind !== "adapt_bias_on" && event.kind !== "adapt_bias_off") {
      continue;
    }
    const list = byTarget.get(event.scoreTarget) ?? [];
    list.push(event);
    byTarget.set(event.scoreTarget, list);
  }

  const flags: ThrashFlag[] = [];
  for (const [scoreTarget, list] of byTarget) {
    const sorted = [...list].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    let flips = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]!.kind !== sorted[i - 1]!.kind) flips += 1;
    }
    if (flips >= ADAPT_OSCILLATION_MIN) {
      flags.push({
        kind: "adapt_oscillation",
        hqUserId: params.hqUserId,
        scoreTarget,
        detail: `${flips} bias flips`,
      });
    }
  }
  return flags;
}

/** Same tip shown repeatedly without improvement signal in rewards. */
export function detectCoachSpam(params: {
  hqUserId: string;
  events: HygieneEventSnapshot[];
  thumbsUpRate: number | null;
  avgQualityScore: number | null;
}): ThrashFlag[] {
  const byTargetTip = new Map<string, number>();
  for (const event of params.events) {
    if (event.kind !== "coach_shown") continue;
    const tipId = tipIdFromPayload(event.payload);
    if (!tipId) continue;
    const key = `${event.scoreTarget}\0${tipId}`;
    byTargetTip.set(key, (byTargetTip.get(key) ?? 0) + 1);
  }

  const stillPoor =
    (params.thumbsUpRate != null && params.thumbsUpRate < 0.55) ||
    (params.avgQualityScore != null && params.avgQualityScore < 0.55);

  const flags: ThrashFlag[] = [];
  for (const [key, count] of byTargetTip) {
    if (count < COACH_SPAM_MIN || !stillPoor) continue;
    const [scoreTarget, tipId] = key.split("\0");
    flags.push({
      kind: "coach_spam",
      hqUserId: params.hqUserId,
      scoreTarget: scoreTarget!,
      detail: `tip ${tipId} shown ${count}×`,
    });
  }
  return flags;
}

/**
 * Quality/thumbs worse in the late window vs early after at least one adapt_on.
 * Uses caller-supplied early/late reward windows.
 */
export function detectWorseningAfterAdapt(params: {
  hqUserId: string;
  scoreTarget: string;
  hadAdaptOn: boolean;
  earlyThumbsUpRate: number | null;
  lateThumbsUpRate: number | null;
  earlyAvgQuality: number | null;
  lateAvgQuality: number | null;
}): ThrashFlag | null {
  if (!params.hadAdaptOn) return null;
  const direction = learningDirectionFromWindows({
    earlyThumbsUpRate: params.earlyThumbsUpRate,
    lateThumbsUpRate: params.lateThumbsUpRate,
    earlyAvgQuality: params.earlyAvgQuality,
    lateAvgQuality: params.lateAvgQuality,
  });
  if (direction !== "regressing") return null;
  return {
    kind: "worsening_after_adapt",
    hqUserId: params.hqUserId,
    scoreTarget: params.scoreTarget,
    detail: "rewards worsened after adapt bias",
  };
}

/** Coach urging denser/steadier capture while adapt already densifying. */
export function detectCrossSignalConflict(params: {
  hqUserId: string;
  events: HygieneEventSnapshot[];
  adaptBiasOnTargets: Set<string>;
}): ThrashFlag[] {
  const denseTips = new Set([
    "chaoticScroll",
    "fastScroll",
    "lowQuality",
    "thumbsDown",
  ]);
  const flags: ThrashFlag[] = [];
  const seen = new Set<string>();

  for (const event of params.events) {
    if (event.kind !== "coach_shown") continue;
    if (!params.adaptBiasOnTargets.has(event.scoreTarget)) continue;
    const tipId = tipIdFromPayload(event.payload);
    if (!tipId || !denseTips.has(tipId)) continue;
    const key = `${event.scoreTarget}:${tipId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({
      kind: "cross_signal_conflict",
      hqUserId: params.hqUserId,
      scoreTarget: event.scoreTarget,
      detail: `coach ${tipId} while adapt bias on`,
    });
  }
  return flags;
}
