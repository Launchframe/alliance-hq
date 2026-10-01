import { describe, expect, it } from "vitest";
import { SUPPORT_TEAM_NAME_MAX } from "./policy.shared";
import { supportCommandSchema } from "./api.shared";

describe("support command schema", () => {
  it("caps create and rename names at the shared policy limit", () => {
    const oversized = "x".repeat(SUPPORT_TEAM_NAME_MAX + 1);
    expect(supportCommandSchema.safeParse({ kind: "createTeam", teamId: "a", name: oversized, leadId: "lead", expectedVersion: 0 }).success).toBe(false);
    expect(supportCommandSchema.safeParse({ kind: "rename", teamId: "a", name: oversized, expectedVersion: 0 }).success).toBe(false);
    expect(supportCommandSchema.safeParse({ kind: "rename", teamId: "a", name: "Cedar", expectedVersion: 0 }).success).toBe(true);
  });
});
