import { describe, expect, it } from "vitest";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import type { Session } from "@/lib/db/schema";

function makeSession(partial: Partial<Session>): Session {
  return {
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    userLabel: null,
    allianceId: null,
    allianceTag: null,
    hqUserId: null,
    currentAllianceId: null,
    id: "s1",
    ...partial,
  };
}

describe("resolveSessionAllianceId", () => {
  it("prefers currentAllianceId over legacy allianceId", () => {
    expect(
      resolveSessionAllianceId(
        makeSession({
          id: "s1",
          currentAllianceId: "hq-1",
          allianceId: "ashed-1",
        }),
      ),
    ).toBe("hq-1");
  });

  it("falls back to allianceId when currentAllianceId is null", () => {
    expect(
      resolveSessionAllianceId(
        makeSession({
          id: "s1",
          allianceId: "ashed-1",
        }),
      ),
    ).toBe("ashed-1");
  });
});
