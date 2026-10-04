import { describe, expect, it } from "vitest";

import { canAccessKnowledgeResource, type KnowledgeActor, type KnowledgeGrant, type KnowledgeResourceAccess } from "./policy.shared";

const author: KnowledgeActor = {
  kind: "web", allianceId: "alliance-a", hqUserId: "author", discordUserId: null,
  isOfficer: true, readableBoardIds: [], editableBoardIds: [],
};
const note: KnowledgeResourceAccess = {
  id: "note:one", allianceId: "alliance-a", kind: "note", ownershipState: "hq",
  ownerHqUserId: "author", ownerDiscordUserId: "discord-author",
};
const peer = { ...author, hqUserId: "peer" };
const grant = (patch: Partial<KnowledgeGrant> = {}): KnowledgeGrant => ({
  resourceId: note.id, allianceId: note.allianceId, subjectKind: "user", subjectId: "peer", role: "read", ...patch,
});

describe("knowledge resource access", () => {
  it("keeps a note private even from another officer", () => {
    expect(canAccessKnowledgeResource(author, note, [], "edit")).toBe(true);
    expect(canAccessKnowledgeResource(peer, note, [], "read")).toBe(false);
    expect(canAccessKnowledgeResource(peer, note, [], "share")).toBe(false);
  });

  it("denies anonymous, other-tenant, and unresolved owners", () => {
    expect(canAccessKnowledgeResource({ ...author, hqUserId: null }, note, [], "read")).toBe(false);
    expect(canAccessKnowledgeResource({ ...author, allianceId: "other" }, note, [], "read")).toBe(false);
    expect(canAccessKnowledgeResource(author, { ...note, ownershipState: "unresolved" }, [grant()], "read")).toBe(false);
    expect(canAccessKnowledgeResource(peer, { ...note, ownerHqUserId: null }, [grant()], "read")).toBe(false);
  });

  it("distinguishes read, edit, and owner-only sharing", () => {
    expect(canAccessKnowledgeResource(peer, note, [grant()], "read")).toBe(true);
    expect(canAccessKnowledgeResource(peer, note, [grant()], "edit")).toBe(false);
    expect(canAccessKnowledgeResource(peer, note, [grant({ role: "edit" })], "edit")).toBe(true);
    expect(canAccessKnowledgeResource(peer, note, [grant({ role: "edit" })], "share")).toBe(false);
    expect(canAccessKnowledgeResource(peer, note, [grant({ allianceId: "other" })], "read")).toBe(false);
    expect(canAccessKnowledgeResource(peer, note, [grant({ resourceId: "note:other" })], "read")).toBe(false);
  });

  it("rechecks officer eligibility for officer and board grants", () => {
    const officers = grant({ subjectKind: "officers", subjectId: "alliance-a", role: "edit" });
    expect(canAccessKnowledgeResource(peer, note, [officers], "edit")).toBe(true);
    expect(canAccessKnowledgeResource({ ...peer, isOfficer: false }, note, [officers], "read")).toBe(false);
    const boardGrant = grant({ subjectKind: "board", subjectId: "board:one", role: "edit" });
    expect(canAccessKnowledgeResource(peer, note, [boardGrant], "read")).toBe(false);
    const reader = { ...peer, readableBoardIds: ["board:one"] };
    expect(canAccessKnowledgeResource(reader, note, [boardGrant], "read")).toBe(true);
    expect(canAccessKnowledgeResource(reader, note, [boardGrant], "edit")).toBe(false);
    expect(canAccessKnowledgeResource({ ...reader, editableBoardIds: ["board:one"] }, note, [boardGrant], "edit")).toBe(true);
    expect(canAccessKnowledgeResource({ ...reader, isOfficer: false }, note, [boardGrant], "read")).toBe(false);
  });

  it("does not let board ownership or a direct grant bypass the officer ceiling", () => {
    const board = { ...note, kind: "board" as const };
    expect(canAccessKnowledgeResource({ ...author, isOfficer: false }, board, [], "read")).toBe(false);
    expect(canAccessKnowledgeResource({ ...peer, isOfficer: false }, board, [grant()], "read")).toBe(false);
  });

  it("keeps Discord-only captures private and prevents relinking from taking a bound note", () => {
    const discord: KnowledgeActor = { ...author, kind: "discord", hqUserId: null, discordUserId: "discord-author", isOfficer: false };
    const unbound = { ...note, ownershipState: "discord" as const, ownerHqUserId: null };
    expect(canAccessKnowledgeResource(discord, unbound, [], "edit")).toBe(true);
    expect(canAccessKnowledgeResource({ ...discord, discordUserId: "someone-else" }, unbound, [], "read")).toBe(false);
    expect(canAccessKnowledgeResource(author, unbound, [], "read")).toBe(false);
    expect(canAccessKnowledgeResource({ ...discord, hqUserId: "author" }, note, [], "edit")).toBe(true);
    expect(canAccessKnowledgeResource({ ...discord, hqUserId: "peer" }, note, [], "read")).toBe(false);
    expect(canAccessKnowledgeResource(discord, { ...note, ownerHqUserId: null }, [], "read")).toBe(false);
  });
});
