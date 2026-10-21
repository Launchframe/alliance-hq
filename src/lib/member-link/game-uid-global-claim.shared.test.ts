import { describe, expect, it } from "vitest";

import { hasConflictingGlobalGameUidPrincipal } from "./game-uid-global-claim.shared";

describe("hasConflictingGlobalGameUidPrincipal", () => {
  it("allows the same HQ user to claim the UID in another alliance", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        hqUserId: "hq-alice",
        hqClaimHqUserIds: ["hq-alice"],
        discordClaims: [],
        commanderOwnerHqUserIds: ["hq-alice"],
      }),
    ).toBe(false);
  });

  it("blocks a different HQ user from claiming an already-linked UID", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        hqUserId: "hq-bob",
        hqClaimHqUserIds: ["hq-alice"],
        discordClaims: [],
        commanderOwnerHqUserIds: ["hq-alice"],
      }),
    ).toBe(true);
  });

  it("blocks when only hq_user_commanders ownership exists", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        hqUserId: "hq-bob",
        hqClaimHqUserIds: [],
        discordClaims: [],
        commanderOwnerHqUserIds: ["hq-alice"],
      }),
    ).toBe(true);
  });

  it("blocks HQ when Discord holds the UID without a matching HQ bridge", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        hqUserId: "hq-bob",
        hqClaimHqUserIds: [],
        discordClaims: [{ discordUserId: "d1", hqUserId: null }],
        commanderOwnerHqUserIds: [],
      }),
    ).toBe(true);
  });

  it("allows HQ when Discord already bridges to the same HQ account", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        hqUserId: "hq-alice",
        hqClaimHqUserIds: [],
        discordClaims: [{ discordUserId: "d1", hqUserId: "hq-alice" }],
        commanderOwnerHqUserIds: [],
      }),
    ).toBe(false);
  });

  it("blocks a different Discord user from claiming the UID", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        discordUserId: "d-bob",
        callerDiscordHqUserId: "hq-bob",
        hqClaimHqUserIds: [],
        discordClaims: [{ discordUserId: "d-alice", hqUserId: "hq-alice" }],
        commanderOwnerHqUserIds: ["hq-alice"],
      }),
    ).toBe(true);
  });

  it("allows the same Discord user when claims are theirs", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        discordUserId: "d-alice",
        callerDiscordHqUserId: "hq-alice",
        hqClaimHqUserIds: ["hq-alice"],
        discordClaims: [{ discordUserId: "d-alice", hqUserId: "hq-alice" }],
        commanderOwnerHqUserIds: ["hq-alice"],
      }),
    ).toBe(false);
  });

  it("allows Discord link when the caller’s HQ bridge already owns the UID on web", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        discordUserId: "d-alice",
        callerDiscordHqUserId: "hq-alice",
        hqClaimHqUserIds: ["hq-alice"],
        discordClaims: [],
        commanderOwnerHqUserIds: ["hq-alice"],
      }),
    ).toBe(false);
  });

  it("blocks Discord-only callers when any HQ claim exists", () => {
    expect(
      hasConflictingGlobalGameUidPrincipal({
        discordUserId: "d-bob",
        callerDiscordHqUserId: null,
        hqClaimHqUserIds: ["hq-alice"],
        discordClaims: [],
        commanderOwnerHqUserIds: [],
      }),
    ).toBe(true);
  });
});
