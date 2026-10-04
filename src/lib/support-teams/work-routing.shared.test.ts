import { describe, expect, it } from "vitest";
import { eligibleWorkRecipient, routeTeamWork, canViewTeamWork, type WorkRecipient } from "./work-routing.shared";

const officer = (id: string, memberIds = [id]): WorkRecipient => ({ id, allianceId: "a", name: id, role: "officer", permissions: ["time_off:write", "trains:write", "vs_compliance:manage"], memberIds, active: true });
const lead = officer("lead");
const owner = { ...officer("owner"), role: "owner" };
const route = (recipients = [lead, owner], away: string[] = []) => routeTeamWork({ allianceId: "a", permission: "trains:write", leadMemberId: "lead", recipients, awayMemberIds: away });

describe("team work routing", () => {
  it("prefers the linked eligible assigned lead", () => expect(route().assigneeId).toBe("lead"));
  it("falls back to the available owner when the lead is away", () => expect(route(undefined, ["lead"]).assigneeId).toBe("owner"));
  it("falls back when a lead is unlinked", () => expect(route([officer("lead", []), owner]).assigneeId).toBe("owner"));
  it("does not route to a departed lead", () => expect(route([{ ...lead, memberIds: [] }, owner]).assigneeId).toBe("owner"));
  it("does not route to revoked memberships", () => expect(route([{ ...lead, active: false }, owner]).assigneeId).toBe("owner"));
  it("does not grant task permissions from team identity", () => expect(route([{ ...lead, permissions: [] }, owner]).assigneeId).toBe("owner"));
  it("ignores other tenants", () => expect(route([{ ...lead, allianceId: "b" }, owner]).assigneeId).toBe("owner"));
  it("keeps work unassigned when leadership is unavailable", () => expect(route(undefined, ["lead", "owner"]).assigneeId).toBeNull());
  it("prefers owner over another officer for fallback", () => expect(route([officer("other"), owner]).assigneeId).toBe("owner"));
  it("restricts compliance to its officer roles even with a custom grant", () => expect(eligibleWorkRecipient({ ...lead, role: "member" }, "a", "vs_compliance:manage")).toBe(false));
  it("requires permissions for owners too", () => expect(eligibleWorkRecipient({ ...owner, permissions: [] }, "a", "trains:write")).toBe(false));
});

describe("team work visibility", () => {
  const work = { allianceId: "a", assigneeId: "lead", requiredPermission: "trains:write", memberId: "member", kind: "coverage" };
  it("retains authorized officer oversight", () => expect(canViewTeamWork(work, owner, false)).toBe(true));
  it("filters personal work to its assignee", () => expect(canViewTeamWork(work, owner, true)).toBe(false));
  it("checks current authorization even for the assignee", () => expect(canViewTeamWork(work, { ...lead, permissions: [] }, true)).toBe(false));
  it("does not expose tasks across tenants", () => expect(canViewTeamWork(work, { ...lead, allianceId: "b" }, true)).toBe(false));
  it("does not expose recommendations merely because a member owns the commander", () => expect(canViewTeamWork({ ...work, requiredPermission: "vs_compliance:manage" }, { ...lead, role: "member", memberIds: ["member"] }, false)).toBe(false));
});
