import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../../drizzle/0138_vs_compliance.sql", import.meta.url), "utf8");
describe("compliance forward migration safety", () => {
  it("retains legacy discipline data and installs additive idempotent structures", () => {
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS vs_compliance_evaluations");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS compliance_event_id");
    expect(migration).toContain("WHERE kind IN ('vs_demotion_task', 'vs_kick_task')");
  });
  it("enforces tenant-scoped unique events, immutable receipts and violation provenance", () => {
    for (const clause of ["UNIQUE(alliance_id, member_id, week_ending)", "UNIQUE(alliance_id, actor_id, request_id)", "vs_compliance_actions_immutable BEFORE UPDATE OR DELETE", "vs_compliance_actions_event_scope_fk", "vs_compliance_jobs_action_scope_fk", "vs_compliance_violation_scope_fk"]) expect(migration).toContain(clause);
  });
  it("invalidates score, absence, policy, roster, tenure and owner changes atomically", () => {
    for (const table of ["alliances", "vs_score_heads", "member_time_off", "member_time_off_revisions", "time_off_sync_bindings", "vs_compliance_policies", "alliance_members", "member_alliance_rank_events", "member_alliance_tenure", "commander_alliance_memberships"]) expect(migration).toContain(`'${table}'`);
    expect(migration).toContain("input_version = vs_compliance_state.input_version + 1");
    expect(migration).toContain("GREATEST(first_week");
  });
  it("fences rank writers during a remote lease and preserves current-stint eligibility on rejoin", () => {
    expect(migration).toContain("lease_expires_at > now()");
    expect(migration).toContain("ERRCODE = '40001'");
    expect(migration).toContain("NEW.joined_at := now()");
    expect(migration).toContain("NEW.status := protected_row.status");
  });
});
