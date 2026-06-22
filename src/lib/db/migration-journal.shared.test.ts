import { describe, expect, it } from "vitest";

import {
  listMigrationSqlTags,
  readJournalEntries,
  resolveSqlTagForJournalEntry,
  sqlTagCoveredByJournal,
  validateMigrationJournal,
} from "../../../scripts/lib/migration-journal.mjs";

describe("migration journal validation", () => {
  it("covers every numbered drizzle migration on disk", () => {
    const result = validateMigrationJournal({ stagedNewPaths: [] });
    expect(result).toEqual({ ok: true });
  });

  it("resolves journal tags to sql files by exact tag or unique prefix", () => {
    const sqlTags = ["0039_train_day_config_tuesday_align", "0040_other"];
    expect(
      resolveSqlTagForJournalEntry("0039_train_day_config_tuesday_align", sqlTags),
    ).toBe("0039_train_day_config_tuesday_align");
    expect(
      sqlTagCoveredByJournal(
        "0039_train_day_config_tuesday_align",
        [{ tag: "0039_train_day_config_tuesday_align" }],
        sqlTags,
      ),
    ).toBe(true);
  });

  it("fails when a new sql file has no journal entry", () => {
    const result = validateMigrationJournal({
      journalPath: "drizzle/meta/_journal.json",
      stagedNewPaths: ["drizzle/9999_orphan_migration.sql"],
      drizzleDir: "drizzle",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e: string) => e.includes("9999_orphan_migration"))).toBe(
        true,
      );
    }
  });

  it("lists migration sql tags and journal entries in repo", () => {
    expect(listMigrationSqlTags().length).toBeGreaterThan(0);
    expect(readJournalEntries().length).toBeGreaterThan(0);
  });
});
