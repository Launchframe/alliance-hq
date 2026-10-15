import { afterAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import {
  closeE2eSql,
  createNativeAlliance,
  getE2eSql,
} from "../../../e2e/fixtures/db";
import { getSqlClient } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import {
  applyProfessionSwitch,
  commitEngAssignment,
} from "@/lib/professions/repository";

type Profession = "Engineer" | "War Leader";

const createdAllianceIds: string[] = [];
const createdCommanderIds: string[] = [];
let usedDatabase = false;

function assertGuardedDatabase() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (
    url !==
    (process.env.E2E_DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim())
  ) {
    throw new Error("test_database_mismatch");
  }
  usedDatabase = true;
}

async function createAlliance() {
  assertGuardedDatabase();
  const alliance = await createNativeAlliance(getE2eSql(), {
    tag: `PS${nanoid(5)}`,
    name: "Profession Switch Race Test",
  });
  createdAllianceIds.push(alliance.allianceId);
  return alliance.allianceId;
}

async function seedCommander(allianceId: string, profession: Profession) {
  const sql = getE2eSql();
  const now = new Date();
  const commanderId = `psc-${nanoid(12)}`;
  const name = `Switch ${nanoid(6)}`;
  createdCommanderIds.push(commanderId);
  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id,
      profession, created_at, updated_at
    ) VALUES (
      ${commanderId}, ${name}, ${name.toLowerCase()}, ${allianceId},
      ${profession}, ${now}, ${now}
    )
  `;
  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${`psm-${nanoid(12)}`}, ${commanderId}, ${allianceId}, ${`psa-${nanoid(12)}`},
      'active', ${now}, ${now}, ${now}
    )
  `;
  return commanderId;
}

async function readProfession(commanderId: string) {
  const [row] = await getE2eSql()`SELECT profession FROM commanders WHERE id = ${commanderId}`;
  return row!.profession as string | null;
}

async function readActiveAssignments(allianceId: string, engCommanderId: string) {
  return getE2eSql()<{ wl_commander_id: string }[]>`
    SELECT t.wl_commander_id
    FROM wl_eng_assignments a
    JOIN wl_teams t ON t.id = a.wl_team_id
    WHERE a.alliance_id = ${allianceId}
      AND a.eng_commander_id = ${engCommanderId}
      AND a.status = 'active'
  `;
}

describe.skipIf(process.env.PROFESSIONS_DB_TEST !== "1")(
  "applyProfessionSwitch / commitEngAssignment serialization (guarded DB)",
  () => {
    afterAll(async () => {
      if (usedDatabase) {
        const sql = getE2eSql();
        if (createdAllianceIds.length > 0) {
          await sql`DELETE FROM wl_team_events WHERE alliance_id IN ${sql(createdAllianceIds)}`;
          await sql`DELETE FROM commander_alliance_memberships WHERE alliance_id IN ${sql(createdAllianceIds)}`;
        }
        if (createdCommanderIds.length > 0) {
          await sql`DELETE FROM commanders WHERE id IN ${sql(createdCommanderIds)}`;
        }
        if (createdAllianceIds.length > 0) {
          await sql`DELETE FROM alliances WHERE id IN ${sql(createdAllianceIds)}`;
        }
      }
      await closeE2eSql();
      if (usedDatabase) await getSqlClient().end({ timeout: 5 });
    });

    it("waits for the alliance availability lock before assigning", async () => {
      const allianceId = await createAlliance();
      const eng = await seedCommander(allianceId, "Engineer");
      const wl = await seedCommander(allianceId, "War Leader");
      let settled = false;
      let assign!: Promise<unknown>;
      await getE2eSql().begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`alliance-availability:${allianceId}`}, 0))`;
        assign = commitEngAssignment({
          allianceId,
          engCommanderId: eng,
          wlCommanderId: wl,
        }).finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled).toBe(false);
        expect(await readActiveAssignments(allianceId, eng)).toHaveLength(0);
      });
      await assign;
      expect(await readActiveAssignments(allianceId, eng)).toEqual([
        { wl_commander_id: wl },
      ]);
    });

    it("rejects a stale fromProfession without mutating", async () => {
      const allianceId = await createAlliance();
      const eng = await seedCommander(allianceId, "Engineer");
      await expect(
        applyProfessionSwitch({
          allianceId,
          commanderId: eng,
          fromProfession: "War Leader",
          toProfession: "Engineer",
        }),
      ).rejects.toThrow("Profession changed concurrently.");
      expect(await readProfession(eng)).toBe("Engineer");
      const [{ count }] = await getE2eSql()`
        SELECT count(*)::int AS count FROM wl_team_events WHERE alliance_id = ${allianceId}
      `;
      expect(count).toBe(0);
    });

    it("an Engineer switching away never keeps an active seat", async () => {
      const allianceId = await createAlliance();
      const wl = await seedCommander(allianceId, "War Leader");
      for (let i = 0; i < 8; i += 1) {
        const eng = await seedCommander(allianceId, "Engineer");
        const [assign, swap] = await Promise.allSettled([
          commitEngAssignment({ allianceId, engCommanderId: eng, wlCommanderId: wl }),
          applyProfessionSwitch({
            allianceId,
            commanderId: eng,
            fromProfession: "Engineer",
            toProfession: "War Leader",
          }),
        ]);
        expect(swap.status).toBe("fulfilled");
        expect(await readProfession(eng)).toBe("War Leader");
        expect(await readActiveAssignments(allianceId, eng)).toHaveLength(0);
        if (assign.status === "rejected") {
          expect(String(assign.reason)).toContain("Commander must be an Engineer.");
        }
      }
    });

    it("a War Leader switching away never keeps an active Engineer", async () => {
      const allianceId = await createAlliance();
      for (let i = 0; i < 8; i += 1) {
        const wl = await seedCommander(allianceId, "War Leader");
        const eng = await seedCommander(allianceId, "Engineer");
        const [assign, swap] = await Promise.allSettled([
          commitEngAssignment({ allianceId, engCommanderId: eng, wlCommanderId: wl }),
          applyProfessionSwitch({
            allianceId,
            commanderId: wl,
            fromProfession: "War Leader",
            toProfession: "Engineer",
          }),
        ]);
        expect(swap.status).toBe("fulfilled");
        expect(await readProfession(wl)).toBe("Engineer");
        expect(await readActiveAssignments(allianceId, eng)).toHaveLength(0);
        if (assign.status === "rejected") {
          expect(String(assign.reason)).toContain("Commander must be a War Leader.");
        }
      }
    });
  },
);
