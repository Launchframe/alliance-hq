import { describe, expect, it, vi } from "vitest";
import { withProposalVoters } from "./proposal-roster.server";
import type { SupportTransaction } from "./repository.server";
import type { SupportRosterMember } from "./types.shared";

function connection(rows: unknown[][]) {
  const select = vi.fn(() => {
    const result = rows.shift();
    const query = { from: () => query, where: () => query, innerJoin: () => query, leftJoin: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  });
  return { select } as unknown as Pick<SupportTransaction, "select">;
}
const roster = [{ id: "r4", rank: 4, hqLinked: false, discordLinked: false }] as SupportRosterMember[];
const linkedAt = new Date("2026-01-01T00:00:00Z");
describe("proposal proven voter bindings", () => {
  it("deduplicates the same HQ principal from legacy, canonical and Discord bindings", async () => {
    const row = { id: "binding", memberId: "r4", principalId: "human", linkedAt };
    const db = connection([[row], [{ ...row, id: "canonical" }], [{ ...row, id: "discord", discordId: "discord-person", hqLinkedAt: linkedAt }]]);
    const result = await withProposalVoters(db, "a", roster);
    expect(result[0].proposalVoterIds).toEqual(["human"]);
    expect(db.select).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(db.select).mock.calls) expect(Object.keys(call[0] ?? {})).not.toContain("gameUid");
  });
  it("retains unlinked Discord identity and cross-layer conflicts rather than inferring names", async () => {
    const db = connection([[{ id: "web", memberId: "r4", principalId: "human", linkedAt }], [], [{ id: "discord", memberId: "r4", principalId: null, discordId: "unlinked", linkedAt }]]);
    expect((await withProposalVoters(db, "a", roster))[0].proposalVoterIds).toEqual(["discord:unlinked", "human"]);
  });
  it("requires review for distinct HQ bindings sharing the same proven commander identity", async () => {
    const db = connection([[{ id: "web", memberId: "r4", principalId: "human", linkedAt, proofKey: "same-proof" }], [{ id: "canonical", memberId: "different-roster-row", principalId: "other-human", linkedAt, proofKey: "same-proof" }], []]);
    const result = await withProposalVoters(db, "a", roster);
    expect(result[0].proposalVoterIds).toEqual(["human", "other-human"]);
    expect(result[0]).not.toHaveProperty("proofKey");
  });
  it("changes the private approval token when an identical human relinks", async () => {
    const row = { id: "binding", memberId: "r4", principalId: "human", linkedAt };
    const first = await withProposalVoters(connection([[row], [], []]), "a", roster);
    const second = await withProposalVoters(connection([[{ ...row, id: "new-binding" }], [], []]), "a", roster);
    expect(first[0].proposalVoterIds).toEqual(second[0].proposalVoterIds);
    expect(first[0].proposalIdentityToken).not.toBe(second[0].proposalIdentityToken);
  });
});
