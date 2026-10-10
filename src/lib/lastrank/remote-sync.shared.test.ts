import { describe, expect, it } from "vitest";

import type { LastRankMatchResult } from "@/lib/lastrank/alliance-page.shared";
import {
  collectLastRankRemoteDecisions,
  lastRankRemoteSyncUrl,
  LASTRANK_REMOTE_SYNC_VERSION,
  listUnappliedRemoteMappings,
  parseLastRankRemoteApplyRequest,
  parseLastRankRemotePlanRequest,
  withoutClaimedHqNames,
  type LastRankRemotePlan,
  type LastRankRemotePrompt,
} from "@/lib/lastrank/remote-sync.shared";

const target = {
  gameServerNumber: 1203,
  tag: "LFgo",
  lastrankAllianceId: "e7d1eaefdcfc42c8ac6c84247d2dad9b",
};

function applyBody(overrides: Record<string, unknown> = {}) {
  return {
    version: LASTRANK_REMOTE_SYNC_VERSION,
    target,
    expectedHqAllianceId: "hq-1",
    decisions: [],
    retireAshedMemberIds: [],
    createAll: false,
    retireAll: false,
    hqOnly: false,
    ...overrides,
  };
}

function prompt(partial: Partial<LastRankRemotePrompt> & { publicId: number }): LastRankRemotePrompt {
  return {
    lastRankName: `LR${partial.publicId}`,
    profileUrl: "https://lastrank.example/p",
    unranked: false,
    suggestions: [],
    remainingHqNames: [],
    ...partial,
  };
}

function plan(partial: Partial<LastRankRemotePlan>): LastRankRemotePlan {
  return {
    version: LASTRANK_REMOTE_SYNC_VERSION,
    target,
    hqAllianceId: "hq-1",
    ashedDualWrite: true,
    lastRankCount: 0,
    matchedCount: 0,
    rosterDiff: {} as LastRankRemotePlan["rosterDiff"],
    prompts: [],
    retireCandidates: [],
    ...partial,
  };
}

describe("lastRankRemoteSyncUrl", () => {
  it("builds the endpoint from an https origin, ignoring any path", () => {
    expect(lastRankRemoteSyncUrl("https://hq.example.com/some/path", "plan")).toBe(
      "https://hq.example.com/api/internal/lastrank/remote-sync/plan",
    );
  });

  it("allows http only for loopback", () => {
    expect(lastRankRemoteSyncUrl("http://localhost:3000", "apply")).toBe(
      "http://localhost:3000/api/internal/lastrank/remote-sync/apply",
    );
    expect(() => lastRankRemoteSyncUrl("http://hq.example.com", "plan")).toThrow(/https/);
  });

  it("rejects garbage", () => {
    expect(() => lastRankRemoteSyncUrl("hq.example.com", "plan")).toThrow();
  });
});

describe("parseLastRankRemotePlanRequest", () => {
  it("accepts a valid target and lowercases the alliance id", () => {
    const result = parseLastRankRemotePlanRequest({
      version: LASTRANK_REMOTE_SYNC_VERSION,
      target: { ...target, lastrankAllianceId: target.lastrankAllianceId.toUpperCase() },
    });
    expect(result).toEqual({ ok: true, value: { version: 1, target } });
  });

  it("rejects bad versions and alliance ids", () => {
    expect(parseLastRankRemotePlanRequest({ version: 99, target }).ok).toBe(false);
    expect(
      parseLastRankRemotePlanRequest({
        version: LASTRANK_REMOTE_SYNC_VERSION,
        target: { ...target, lastrankAllianceId: "nope" },
      }).ok,
    ).toBe(false);
  });
});

describe("parseLastRankRemoteApplyRequest", () => {
  it("accepts a valid body", () => {
    const result = parseLastRankRemoteApplyRequest(
      applyBody({
        decisions: [
          { publicId: 1, answer: { kind: "match", hqName: " Alpha " } },
          { publicId: 2, answer: { kind: "create" } },
        ],
        retireAshedMemberIds: ["m-1"],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decisions[0]?.answer).toEqual({ kind: "match", hqName: "Alpha" });
    }
  });

  it("rejects explicit retire ids combined with retireAll", () => {
    const result = parseLastRankRemoteApplyRequest(
      applyBody({ retireAll: true, retireAshedMemberIds: ["m-1"] }),
    );
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/retireAll/) });
  });

  it("rejects duplicate publicIds", () => {
    const result = parseLastRankRemoteApplyRequest(
      applyBody({
        decisions: [
          { publicId: 1, answer: { kind: "skip" } },
          { publicId: 1, answer: { kind: "create" } },
        ],
      }),
    );
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/duplicate/) });
  });

  it("rejects unknown answer kinds and missing fields", () => {
    expect(
      parseLastRankRemoteApplyRequest(
        applyBody({ decisions: [{ publicId: 1, answer: { kind: "delete" } }] }),
      ).ok,
    ).toBe(false);
    expect(parseLastRankRemoteApplyRequest(applyBody({ hqOnly: undefined })).ok).toBe(false);
  });
});

describe("withoutClaimedHqNames", () => {
  it("drops claimed names case-insensitively", () => {
    const filtered = withoutClaimedHqNames(
      prompt({
        publicId: 1,
        suggestions: [
          { commanderId: "c1", name: "Alpha", score: 0.9 },
          { commanderId: "c2", name: "Beta", score: 0.5 },
        ],
        remainingHqNames: ["Alpha", "Beta", "Gamma"],
      }),
      new Set(["alpha"]),
    );
    expect(filtered.suggestions.map((s) => s.name)).toEqual(["Beta"]);
    expect(filtered.remainingHqNames).toEqual(["Beta", "Gamma"]);
  });
});

describe("collectLastRankRemoteDecisions", () => {
  it("records matches and creates, skips unranked creates, and hides claimed names", async () => {
    const seen: LastRankRemotePrompt[] = [];
    const answers = [
      { kind: "match" as const, hqName: "Alpha" },
      { kind: "create" as const },
      { kind: "create" as const },
      { kind: "skip" as const },
    ];
    const result = await collectLastRankRemoteDecisions({
      plan: plan({
        prompts: [
          prompt({ publicId: 1, remainingHqNames: ["Alpha", "Beta"] }),
          prompt({ publicId: 2, remainingHqNames: ["Alpha", "Beta"] }),
          prompt({ publicId: 3, unranked: true }),
          prompt({ publicId: 4 }),
        ],
        retireCandidates: [
          { ashedMemberId: "m-alpha", memberName: "Alpha" },
          { ashedMemberId: "m-beta", memberName: "Beta" },
          { ashedMemberId: "m-gamma", memberName: "Gamma" },
        ],
      }),
      interactivePrompt: async (ctx) => {
        seen.push(ctx);
        return answers[seen.length - 1]!;
      },
      retirePrompt: async (candidate) => candidate.memberName === "Beta",
    });

    expect(seen[1]?.remainingHqNames).toEqual(["Beta"]);
    expect(result.decisions).toEqual([
      { publicId: 1, answer: { kind: "match", hqName: "Alpha" } },
      { publicId: 2, answer: { kind: "create" } },
    ]);
    expect(result.retireAshedMemberIds).toEqual(["m-beta"]);
    expect(result.stats).toEqual({
      mapped: 1,
      creates: 1,
      retires: 1,
      skipped: 2,
      remaining: 0,
    });
  });

  it("does not offer retirements without a retire prompt", async () => {
    const result = await collectLastRankRemoteDecisions({
      plan: plan({ retireCandidates: [{ ashedMemberId: "m-1", memberName: "X" }] }),
      interactivePrompt: async () => ({ kind: "skip" }),
    });
    expect(result.retireAshedMemberIds).toEqual([]);
  });
});

describe("listUnappliedRemoteMappings", () => {
  it("lists match decisions whose row did not end up matched", () => {
    const match = {
      matched: [{ lastRank: { publicId: 1 } }],
      unmatched: [],
      unmatchedHq: [],
    } as unknown as LastRankMatchResult;
    expect(
      listUnappliedRemoteMappings(
        [
          { publicId: 1, answer: { kind: "match", hqName: "Alpha" } },
          { publicId: 2, answer: { kind: "match", hqName: "Beta" } },
          { publicId: 3, answer: { kind: "create" } },
        ],
        match,
      ),
    ).toEqual([{ publicId: 2, hqName: "Beta" }]);
  });
});
