import { z } from "zod";

import {
  isLastRankAllianceId,
  isLastRankInteractiveRename,
  type LastRankInteractiveAnswer,
  type LastRankMatchResult,
  type LastRankPromptPosition,
  type LastRankSuggestionSignals,
} from "@/lib/lastrank/alliance-page.shared";
import type { LastRankRosterDiff } from "@/lib/lastrank/roster-diff.shared";
import type {
  LastRankInteractiveWriteSummary,
  LastRankSyncPlanListener,
  LastRankSyncPlanStats,
} from "@/lib/lastrank/sync-plan.shared";
import type { LastRankSyncTarget } from "@/lib/lastrank/sync-registry.shared";

/**
 * Wire contract for `npm run lastrank:sync -- --remote <origin>`: the server
 * plans (dry run) and applies with its own DB + Ashed credential, while the
 * operator answers prompts locally. Payloads carry names and internal ids only —
 * never player UIDs.
 */
export const LASTRANK_REMOTE_SYNC_VERSION = 1;

/** Alliances cap at 100 members; this leaves room for listed leavers. */
export const LASTRANK_REMOTE_SYNC_MAX_DECISIONS = 200;

/** HTTPS only, except loopback for local testing. */
export function lastRankRemoteSyncUrl(origin: string, step: "plan" | "apply"): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`--remote must be an origin like https://hq.example.com (got "${origin}")`);
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("--remote must use https:// (http:// only for localhost)");
  }
  return new URL(`/api/internal/lastrank/remote-sync/${step}`, url.origin).toString();
}

export type LastRankRemotePrompt = {
  publicId: number;
  lastRankName: string;
  profileUrl: string;
  unranked: boolean;
  suggestions: Array<{
    commanderId: string;
    name: string;
    score: number;
    signals?: LastRankSuggestionSignals;
  }>;
  remainingHqNames: string[];
};

export type LastRankRemoteRetireCandidate = {
  ashedMemberId: string;
  memberName: string;
  /** Lets a mapping typed by an old name still keep this member off the retire list. */
  previousNames?: string[];
};

/**
 * Members the operator mapped this session, by id. Mirrors the server's name
 * resolution: an exact current-name hit wins, else a unique previous-name hit.
 */
export function claimedRetireCandidateIds(
  candidates: readonly LastRankRemoteRetireCandidate[],
  claimedNames: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  const norm = (name: string) => name.trim().toLowerCase();
  for (const claimed of claimedNames) {
    const current = candidates.filter((row) => norm(row.memberName) === claimed);
    if (current.length > 0) {
      for (const row of current) ids.add(row.ashedMemberId);
      continue;
    }
    const previous = candidates.filter((row) =>
      (row.previousNames ?? []).some((name) => norm(name) === claimed),
    );
    if (previous.length === 1) ids.add(previous[0].ashedMemberId);
  }
  return ids;
}

export type LastRankRemotePlan = {
  version: typeof LASTRANK_REMOTE_SYNC_VERSION;
  target: LastRankSyncTarget;
  hqAllianceId: string;
  ashedDualWrite: boolean;
  lastRankCount: number;
  matchedCount: number;
  rosterDiff: LastRankRosterDiff;
  prompts: LastRankRemotePrompt[];
  /** Active HQ members not auto-matched to LastRank (before interactive mapping). */
  retireCandidates: LastRankRemoteRetireCandidate[];
};

export type LastRankRemoteDecision = {
  publicId: number;
  answer: LastRankInteractiveAnswer;
};

export type LastRankRemoteApplyRequest = {
  version: typeof LASTRANK_REMOTE_SYNC_VERSION;
  target: LastRankSyncTarget;
  expectedHqAllianceId: string;
  decisions: LastRankRemoteDecision[];
  retireAshedMemberIds: string[];
  createAll: boolean;
  retireAll: boolean;
  hqOnly: boolean;
};

const targetSchema = z.object({
  gameServerNumber: z.number().int().positive(),
  tag: z.string().trim().min(1).max(32),
  lastrankAllianceId: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isLastRankAllianceId, "invalid LastRank alliance id"),
});

const answerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("skip") }),
  z.object({ kind: z.literal("create") }),
  z.object({ kind: z.literal("match"), hqName: z.string().trim().min(1).max(100) }),
]);

const planRequestSchema = z.object({
  version: z.literal(LASTRANK_REMOTE_SYNC_VERSION),
  target: targetSchema,
});

const applyRequestSchema = z.object({
  version: z.literal(LASTRANK_REMOTE_SYNC_VERSION),
  target: targetSchema,
  expectedHqAllianceId: z.string().trim().min(1).max(64),
  decisions: z
    .array(z.object({ publicId: z.number().int().nonnegative(), answer: answerSchema }))
    .max(LASTRANK_REMOTE_SYNC_MAX_DECISIONS),
  retireAshedMemberIds: z
    .array(z.string().trim().min(1).max(64))
    .max(LASTRANK_REMOTE_SYNC_MAX_DECISIONS),
  createAll: z.boolean(),
  retireAll: z.boolean(),
  hqOnly: z.boolean(),
});

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function toParseResult<T>(
  parsed: { success: true; data: T } | { success: false; error: z.ZodError },
): ParseResult<T> {
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    error: issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "invalid body",
  };
}

export function parseLastRankRemotePlanRequest(
  body: unknown,
): ParseResult<{ target: LastRankSyncTarget }> {
  return toParseResult(planRequestSchema.safeParse(body));
}

export function parseLastRankRemoteApplyRequest(
  body: unknown,
): ParseResult<LastRankRemoteApplyRequest> {
  const parsed = toParseResult(applyRequestSchema.safeParse(body));
  if (!parsed.ok) return parsed;
  const { value } = parsed;
  if (value.retireAll && value.retireAshedMemberIds.length > 0) {
    return {
      ok: false,
      error: "retireAshedMemberIds: must be empty with retireAll",
    };
  }
  const seen = new Set<number>();
  for (const decision of value.decisions) {
    if (seen.has(decision.publicId)) {
      return { ok: false, error: `decisions: duplicate publicId ${decision.publicId}` };
    }
    seen.add(decision.publicId);
  }
  return parsed;
}

/**
 * Removes names the operator already mapped this session so later prompts do
 * not offer the same HQ member twice. The server still resolves authoritatively.
 */
export function withoutClaimedHqNames(
  prompt: LastRankRemotePrompt,
  claimedNames: ReadonlySet<string>,
): LastRankRemotePrompt {
  if (claimedNames.size === 0) return prompt;
  const isClaimed = (name: string) => claimedNames.has(name.trim().toLowerCase());
  return {
    ...prompt,
    suggestions: prompt.suggestions.filter((s) => !isClaimed(s.name)),
    remainingHqNames: prompt.remainingHqNames.filter((name) => !isClaimed(name)),
  };
}

type RemoteNameDecisionEntry =
  | { kind: "skip" }
  | { kind: "match"; publicId: number; hqName: string }
  | { kind: "create"; publicId: number };

function remoteStatsFromStack(
  stack: readonly RemoteNameDecisionEntry[],
  retires: number,
  remaining: number,
): LastRankSyncPlanStats {
  let mapped = 0;
  let creates = 0;
  let skipped = 0;
  for (const entry of stack) {
    if (entry.kind === "match") mapped += 1;
    else if (entry.kind === "create") creates += 1;
    else skipped += 1;
  }
  return { mapped, creates, retires, skipped, remaining };
}

function claimedNamesFromStack(
  stack: readonly RemoteNameDecisionEntry[],
): Set<string> {
  const claimed = new Set<string>();
  for (const entry of stack) {
    if (entry.kind === "match") claimed.add(entry.hqName.trim().toLowerCase());
  }
  return claimed;
}

function decisionsFromStack(
  stack: readonly RemoteNameDecisionEntry[],
): LastRankRemoteDecision[] {
  const decisions: LastRankRemoteDecision[] = [];
  for (const entry of stack) {
    if (entry.kind === "match") {
      decisions.push({
        publicId: entry.publicId,
        answer: { kind: "match", hqName: entry.hqName },
      });
    } else if (entry.kind === "create") {
      decisions.push({
        publicId: entry.publicId,
        answer: { kind: "create" },
      });
    }
  }
  return decisions;
}

/** Build the confirm summary from remote prompt decisions (renames + creates). */
export function buildInteractiveWriteSummaryFromRemoteDecisions(
  plan: LastRankRemotePlan,
  decisions: readonly LastRankRemoteDecision[],
): LastRankInteractiveWriteSummary {
  const byPublicId = new Map(
    plan.prompts.map((prompt) => [prompt.publicId, prompt]),
  );
  const renames: LastRankInteractiveWriteSummary["renames"] = [];
  const creates: LastRankInteractiveWriteSummary["creates"] = [];
  for (const decision of decisions) {
    const prompt = byPublicId.get(decision.publicId);
    if (!prompt) continue;
    if (decision.answer.kind === "create") {
      creates.push({
        lastRankName: prompt.lastRankName,
        publicId: decision.publicId,
      });
      continue;
    }
    if (
      decision.answer.kind === "match" &&
      isLastRankInteractiveRename(decision.answer.hqName, prompt.lastRankName)
    ) {
      renames.push({
        priorHqName: decision.answer.hqName,
        lastRankName: prompt.lastRankName,
        publicId: decision.publicId,
      });
    }
  }
  return { renames, creates };
}

/**
 * Runs the operator prompts for a remote plan without touching the server and
 * returns the decisions to send. Mirrors the server's queue rules: unranked
 * rows are never created, and members mapped this session are not offered for
 * retirement. `U` / undo rewinds the last name decision.
 */
export async function collectLastRankRemoteDecisions(input: {
  plan: LastRankRemotePlan;
  interactivePrompt: (
    ctx: LastRankRemotePrompt,
    position: LastRankPromptPosition,
  ) => Promise<LastRankInteractiveAnswer>;
  retirePrompt?: (ctx: LastRankRemoteRetireCandidate) => Promise<boolean>;
  onPlanChanged?: LastRankSyncPlanListener;
}): Promise<{
  decisions: LastRankRemoteDecision[];
  retireAshedMemberIds: string[];
  stats: LastRankSyncPlanStats;
}> {
  const stack: RemoteNameDecisionEntry[] = [];
  const retireAshedMemberIds: string[] = [];
  const emit = (remaining: number) => {
    input.onPlanChanged?.(
      remoteStatsFromStack(stack, retireAshedMemberIds.length, remaining),
    );
  };

  const { prompts } = input.plan;
  let index = 0;
  while (index < prompts.length) {
    const prompt = prompts[index]!;
    const claimed = claimedNamesFromStack(stack);
    const answer = await input.interactivePrompt(
      withoutClaimedHqNames(prompt, claimed),
      { current: index + 1, total: prompts.length },
    );

    if (answer.kind === "undo") {
      if (stack.length === 0) {
        console.error("Nothing to undo.");
        continue;
      }
      stack.pop();
      index = stack.length;
      emit(prompts.length - index);
      continue;
    }

    if (answer.kind === "match") {
      stack.push({
        kind: "match",
        publicId: prompt.publicId,
        hqName: answer.hqName,
      });
    } else if (answer.kind === "create" && !prompt.unranked) {
      stack.push({ kind: "create", publicId: prompt.publicId });
    } else {
      stack.push({ kind: "skip" });
    }
    index = stack.length;
    emit(prompts.length - index);
  }

  if (input.retirePrompt) {
    const claimed = claimedNamesFromStack(stack);
    const claimedIds = claimedRetireCandidateIds(
      input.plan.retireCandidates,
      claimed,
    );
    const candidates = input.plan.retireCandidates.filter(
      (row) => !claimedIds.has(row.ashedMemberId),
    );
    for (const [retireIndex, candidate] of candidates.entries()) {
      if (await input.retirePrompt(candidate)) {
        retireAshedMemberIds.push(candidate.ashedMemberId);
      }
      emit(candidates.length - retireIndex - 1);
    }
  }

  return {
    decisions: decisionsFromStack(stack),
    retireAshedMemberIds,
    stats: remoteStatsFromStack(stack, retireAshedMemberIds.length, 0),
  };
}

/** Mapping decisions that did not become a match on the server (name drift / conflict). */
export function listUnappliedRemoteMappings(
  decisions: readonly LastRankRemoteDecision[],
  match: LastRankMatchResult,
): Array<{ publicId: number; hqName: string }> {
  const matchedPublicIds = new Set(
    match.matched.map((row) => row.lastRank.publicId),
  );
  return decisions.flatMap((decision) =>
    decision.answer.kind === "match" && !matchedPublicIds.has(decision.publicId)
      ? [{ publicId: decision.publicId, hqName: decision.answer.hqName }]
      : [],
  );
}

/** Machine-readable sync summary printed by the CLI (local and remote). */
export function buildLastRankSyncSummary<TApply>(result: {
  tag: string;
  gameServerNumber: number;
  lastrankAllianceId: string;
  hqAllianceId: string;
  allianceCreated: boolean;
  lastRankCount: number;
  rosterDiff: LastRankRosterDiff;
  ashedCredentialSaved: boolean;
  ashedDualWrite: boolean;
  match: LastRankMatchResult;
  apply: TApply;
}) {
  const { match } = result;
  return {
    tag: result.tag,
    gameServerNumber: result.gameServerNumber,
    lastrankAllianceId: result.lastrankAllianceId,
    hqAllianceId: result.hqAllianceId,
    allianceCreated: result.allianceCreated,
    lastRankCount: result.lastRankCount,
    rosterDiff: result.rosterDiff,
    ashedCredentialSaved: result.ashedCredentialSaved,
    ashedDualWrite: result.ashedDualWrite,
    matched: match.matched.length,
    unmatched: match.unmatched.filter((r) => r.status === "unmatched").length,
    ambiguous: match.unmatched.filter((r) => r.status === "ambiguous").length,
    unmatchedHq: match.unmatchedHq.length,
    matchMethods: match.matched.reduce<Record<string, number>>((acc, row) => {
      acc[row.matchMethod] = (acc[row.matchMethod] ?? 0) + 1;
      return acc;
    }, {}),
    ranks: match.matched.reduce<Record<string, number>>((acc, row) => {
      const key =
        row.lastRank.allianceRank != null ? `R${row.lastRank.allianceRank}` : "unset";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    apply: result.apply,
    unmatchedNames: match.unmatched.map((r) => ({
      status: r.status,
      name: r.lastRank.name,
      suggestions: r.suggestions.slice(0, 3).map((s) => ({
        name: s.name,
        score: Number(s.score.toFixed(2)),
      })),
    })),
    unmatchedHqNames: match.unmatchedHq.map(
      (r) => r.currentNames[0] ?? r.previousNames[0],
    ),
  };
}

export type LastRankSyncSummary<TApply = unknown> = ReturnType<
  typeof buildLastRankSyncSummary<TApply>
>;
