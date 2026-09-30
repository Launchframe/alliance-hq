import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getE2eSql, closeE2eSql } from "../../../e2e/fixtures/db";
import { createNativeVsScenario } from "../../../e2e/fixtures/vs-evidence";
import { getSqlClient } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { addCalendarDays, getWeekStartMonday } from "@/lib/trains/game-time";
import {
  applyVerifiedVsMatchupSnapshot,
  resolveVsMatchConflict,
  saveVsMatchDayResult,
  saveVsMatchupIdentity,
} from "./match-results.server";
import { loadVsMatchup } from "./match-results.repository.server";
import { vsScope } from "./vs-scope.server";
import type { VsActor } from "./weekly-view.shared";

let usedDatabase = false;

function lastWeekStart(): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return getWeekStartMonday(addCalendarDays(today, -7));
}

async function setup() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (
    url !==
    (process.env.E2E_DATABASE_URL?.trim() ||
      process.env.LOCAL_DATABASE_URL?.trim())
  ) {
    throw new Error("test_database_mismatch");
  }
  usedDatabase = true;
  const sql = getE2eSql();
  const fixture = await createNativeVsScenario(sql);
  const actor: VsActor = {
    sessionId: fixture.officer.sessionId,
    hqUserId: fixture.officer.hqUserId,
    allianceId: fixture.allianceId,
  };
  const weekStart = lastWeekStart();
  const matchup = await saveVsMatchupIdentity(actor, {
    weekStart,
    opponentName: "FOE",
    opponentTag: "F1",
    expectedVersion: 0,
    scope: vsScope(actor, weekStart),
  });
  return { sql, fixture, actor, weekStart, matchup };
}

const counts = async (sql: ReturnType<typeof getE2eSql>, matchupId: string) => {
  const heads =
    await sql`select count(*)::int as c from vs_match_day_results where matchup_id = ${matchupId}`;
  const obs =
    await sql`select count(*)::int as c from vs_match_observations where matchup_id = ${matchupId}`;
  return { heads: heads[0]!.c, observations: obs[0]!.c };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("unexpected_external_request")),
  );
});

describe.skipIf(process.env.VS_EVIDENCE_DB_TEST !== "1")(
  "vs match results with guarded real DB",
  () => {
    afterAll(async () => {
      vi.unstubAllGlobals();
      await closeE2eSql();
      if (usedDatabase) await getSqlClient().end({ timeout: 5 });
    });

    it("rolls back head+observation when the save fails inside the transaction", async () => {
      const { sql, actor, weekStart, matchup } = await setup();
      const recordedDate = weekStart;
      const scope = vsScope(actor, weekStart);
      const before = await counts(sql, matchup.id);

      await expect(
        saveVsMatchDayResult({
          actor,
          matchupId: matchup.id,
          recordedDate,
          expectedVersion: 99,
          requestId: randomUUID(),
          totals: { ourScore: "10", opponentScore: "4" },
          reportedOutcome: "won",
          finality: "final",
          scope,
          evidence: { kind: "hq_manual" },
        }),
      ).rejects.toMatchObject({ code: "stale" });

      const after = await counts(sql, matchup.id);
      expect(after.heads).toBe(before.heads);
      expect(after.observations).toBe(before.observations);
    });

    it("commits once for duplicate concurrent saves of the same request", async () => {
      const { sql, actor, weekStart, matchup } = await setup();
      const recordedDate = weekStart;
      const scope = vsScope(actor, weekStart);
      const input = {
        actor,
        matchupId: matchup.id,
        recordedDate,
        expectedVersion: 0,
        requestId: randomUUID(),
        totals: { ourScore: "10", opponentScore: "4" },
        reportedOutcome: "won" as const,
        finality: "final" as const,
        scope,
        evidence: { kind: "hq_manual" as const },
      };
      const [a, b] = await Promise.all([
        saveVsMatchDayResult(input),
        saveVsMatchDayResult(input),
      ]);
      expect(a.id).toBe(b.id);
      const after = await counts(sql, matchup.id);
      expect(after.heads).toBe(1);
      expect(after.observations).toBe(1);
    });

    it("rejects the same requestId with different content", async () => {
      const { actor, weekStart, matchup } = await setup();
      const recordedDate = weekStart;
      const scope = vsScope(actor, weekStart);
      const requestId = randomUUID();
      const base = {
        actor,
        matchupId: matchup.id,
        recordedDate,
        expectedVersion: 0,
        requestId,
        finality: "final" as const,
        scope,
        evidence: { kind: "hq_manual" as const },
      };
      const saved = await saveVsMatchDayResult({
        ...base,
        totals: { ourScore: "10", opponentScore: "4" },
        reportedOutcome: "won",
      });
      await expect(
        saveVsMatchDayResult({
          ...base,
          expectedVersion: saved.version,
          totals: { ourScore: "10", opponentScore: "9" },
          reportedOutcome: "won",
        }),
      ).rejects.toMatchObject({ code: "stale" });
      const replay = await saveVsMatchDayResult({
        ...base,
        totals: { ourScore: "10", opponentScore: "4" },
        reportedOutcome: "won",
      });
      expect(replay.id).toBe(saved.id);
    });

    it("keeps HQ results on an Ashed mismatch and resolves the conflict", async () => {
      const { sql, actor, weekStart, matchup } = await setup();
      const recordedDate = weekStart;
      const scope = vsScope(actor, weekStart);
      await saveVsMatchDayResult({
        actor,
        matchupId: matchup.id,
        recordedDate,
        expectedVersion: 0,
        requestId: randomUUID(),
        totals: { ourScore: "10", opponentScore: "4" },
        reportedOutcome: "won",
        finality: "final",
        scope,
        evidence: { kind: "hq_manual" },
      });

      const view = await applyVerifiedVsMatchupSnapshot(actor, {
        weekStart,
        opponent: { name: "FOE", tag: "F1", externalId: "ext-1" },
        days: [
          {
            recordedDate,
            totals: { ourScore: "4", opponentScore: "10" },
            reportedOutcome: "lost",
            finality: "final",
            sourceUpdatedAt: new Date().toISOString(),
          },
        ],
      });

      const day = view.days.find((d) => d.recordedDate === recordedDate);
      expect(day?.outcome).toBe("won");
      const conflict = view.conflicts.find(
        (c) => c.recordedDate === recordedDate,
      );
      expect(conflict?.result.outcome).toBe("lost");

      const kept = await resolveVsMatchConflict(actor, conflict!.id, {
        action: "keep_hq",
        nativeVersion: day!.version,
        scope,
      });
      expect(kept.outcome).toBe("won");

      const head =
        await sql`select outcome, source from vs_match_day_results where matchup_id = ${matchup.id} and recorded_date = ${recordedDate}`;
      expect(head[0]!.outcome).toBe("won");

      const view2 = await loadVsMatchup(actor.allianceId, weekStart);
      const day2 = view2?.days.find((d) => d.recordedDate === recordedDate);
      const conflict2 = view2?.conflicts.find(
        (c) => c.recordedDate === recordedDate,
      );
      expect(conflict2).toBeUndefined();
      const accepted = await resolveVsMatchConflict(actor, conflict!.id, {
        action: "use_ashed",
        nativeVersion: day2!.version,
        scope,
      }).catch((e) => e);
      expect(accepted).toMatchObject({ code: "stale" });
    });
  },
);
