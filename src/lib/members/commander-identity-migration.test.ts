import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(process.cwd(), "drizzle/0056_commander_nullable_uid.sql"),
  "utf8",
);

describe("0056 commander nullable UID migration", () => {
  it("repairs UID-known commander memberships before orphan backfill", () => {
    const uidRepairIndex = migrationSql.indexOf(
      "UID-known roster rows may have been skipped by 0055",
    );
    const orphanBackfillIndex = migrationSql.indexOf(
      "Orphan commanders for roster rows without commander membership.",
    );

    expect(uidRepairIndex).toBeGreaterThanOrEqual(0);
    expect(orphanBackfillIndex).toBeGreaterThan(uidRepairIndex);
    expect(migrationSql).toContain(
      'ON CONFLICT ("game_uid") WHERE "game_uid" IS NOT NULL DO UPDATE SET',
    );
    expect(migrationSql).toContain(
      'UPDATE "commander_alliance_memberships" cam',
    );
    expect(migrationSql).toContain(
      'INNER JOIN "commanders" c ON c."game_uid" = trim(am."game_uid")',
    );
  });
});
