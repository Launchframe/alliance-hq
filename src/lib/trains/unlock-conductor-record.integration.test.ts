import { afterAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import {
  closeE2eSql,
  createAllianceRosterMember,
  createNativeAlliance,
  getE2eSql,
} from "../../../e2e/fixtures/db";
import { getSqlClient } from "@/lib/db";
import { getDatabaseUrl } from "@/lib/db/url";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import {
  lockConductorRecord,
  unlockConductorRecord,
} from "@/lib/trains/repository";

const DATE = "2099-02-03";
const createdAllianceIds: string[] = [];
let usedDatabase = false;

async function setupLockedRecord() {
  const url = getDatabaseUrl();
  assertE2eDatabaseUrl(url);
  if (
    url !==
    (process.env.E2E_DATABASE_URL?.trim() || process.env.LOCAL_DATABASE_URL?.trim())
  ) {
    throw new Error("test_database_mismatch");
  }
  usedDatabase = true;
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `UL${nanoid(5)}`,
    name: "Unlock Race Test",
  });
  createdAllianceIds.push(alliance.allianceId);
  const member = await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Unlock Conductor",
  });
  const recordId = `ulrec-${nanoid(10)}`;
  await sql`INSERT INTO train_conductor_records (id, alliance_id, date, conductor_member_id, conductor_member_name)
    VALUES (${recordId}, ${alliance.allianceId}, ${DATE}, ${member.ashedMemberId}, 'Unlock Conductor')`;
  await lockConductorRecord(recordId, alliance.allianceId, null);
  return { sql, allianceId: alliance.allianceId, recordId };
}

async function readState(sql: ReturnType<typeof getE2eSql>, recordId: string) {
  const [record] = await sql`SELECT locked_at FROM train_conductor_records WHERE id = ${recordId}`;
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM train WHERE conductor_record_id = ${recordId}`;
  return { locked: record!.locked_at != null, trainCount: count as number };
}

describe.skipIf(process.env.TRAINS_DB_TEST !== "1")(
  "unlockConductorRecord schedule-lock serialization (guarded DB)",
  () => {
    afterAll(async () => {
      if (usedDatabase && createdAllianceIds.length > 0) {
        await getE2eSql()`DELETE FROM alliances WHERE id IN ${getE2eSql()(createdAllianceIds)}`;
      }
      await closeE2eSql();
      if (usedDatabase) await getSqlClient().end({ timeout: 5 });
    });

    it("waits for the alliance schedule lock before unlocking", async () => {
      const { sql, allianceId, recordId } = await setupLockedRecord();
      let settled = false;
      let unlock!: Promise<unknown>;
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`alliance-availability:${allianceId}`}, 0))`;
        unlock = unlockConductorRecord(recordId, allianceId).finally(() => {
          settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(settled).toBe(false);
        expect(await readState(sql, recordId)).toEqual({ locked: true, trainCount: 1 });
      });
      await unlock;
      expect(await readState(sql, recordId)).toEqual({ locked: false, trainCount: 0 });
    });

    it("concurrent unlock and re-lock never leave a locked day without its train", async () => {
      const { sql, allianceId, recordId } = await setupLockedRecord();
      for (let i = 0; i < 8; i += 1) {
        await Promise.allSettled([
          unlockConductorRecord(recordId, allianceId),
          lockConductorRecord(recordId, allianceId, null),
        ]);
        const state = await readState(sql, recordId);
        expect(state.trainCount).toBe(state.locked ? 1 : 0);
        if (!state.locked) await lockConductorRecord(recordId, allianceId, null);
      }
    });

    it("authorize sees the locked row and aborts without mutating", async () => {
      const { sql, allianceId, recordId } = await setupLockedRecord();
      let seenLockedAt: Date | null = null;
      await expect(
        unlockConductorRecord(recordId, allianceId, {
          authorize: (existing) => {
            seenLockedAt = existing.lockedAt;
            return false;
          },
        }),
      ).rejects.toThrow("not permitted");
      expect(seenLockedAt).toBeInstanceOf(Date);
      expect(await readState(sql, recordId)).toEqual({ locked: true, trainCount: 1 });
    });
  },
);
