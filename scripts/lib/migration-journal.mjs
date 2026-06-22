import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const JOURNAL_PATH = "drizzle/meta/_journal.json";
const SQL_PATTERN = /^\d{4}_.*\.sql$/;

/** @returns {string[]} migration tags (filename without .sql) */
export function listMigrationSqlTags(drizzleDir = "drizzle") {
  if (!existsSync(drizzleDir)) return [];
  return readdirSync(drizzleDir)
    .filter((name) => SQL_PATTERN.test(name))
    .map((name) => name.replace(/\.sql$/, ""))
    .sort();
}

/** @returns {{ tag: string }[]} */
export function readJournalEntries(journalPath = JOURNAL_PATH) {
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  return journal.entries ?? [];
}

/**
 * Resolve which on-disk SQL tag a journal entry applies to (mirrors db-migrate.mjs).
 * @param {string} entryTag
 * @param {string[]} sqlTags
 */
export function resolveSqlTagForJournalEntry(entryTag, sqlTags) {
  if (sqlTags.includes(entryTag)) {
    return entryTag;
  }

  const prefix = entryTag.match(/^(\d{4})_/)?.[1];
  if (!prefix) {
    return null;
  }

  const matches = sqlTags.filter((tag) => tag.startsWith(`${prefix}_`));
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    return null;
  }

  throw new Error(
    `Ambiguous migration prefix ${prefix}: ${matches.join(", ")}`,
  );
}

/** @param {string} sqlTag */
export function sqlTagCoveredByJournal(sqlTag, journalEntries, sqlTags) {
  if (journalEntries.some((entry) => entry.tag === sqlTag)) {
    return true;
  }

  for (const entry of journalEntries) {
    try {
      if (resolveSqlTagForJournalEntry(entry.tag, sqlTags) === sqlTag) {
        return true;
      }
    } catch {
      // prefix ambiguity — reported separately
    }
  }

  return false;
}

/** Staged new migration SQL paths (git add), e.g. drizzle/0039_foo.sql */
export function listStagedNewMigrationSqlPaths() {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=A", {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((path) => /^drizzle\/\d{4}_.*\.sql$/.test(path));
  } catch {
    return [];
  }
}

/**
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateMigrationJournal(options = {}) {
  const journalPath = options.journalPath ?? JOURNAL_PATH;
  const drizzleDir = options.drizzleDir ?? "drizzle";
  const stagedNewPaths = options.stagedNewPaths ?? listStagedNewMigrationSqlPaths();

  const errors = [];
  const sqlTags = listMigrationSqlTags(drizzleDir);
  const journalEntries = readJournalEntries(journalPath);

  for (const entry of journalEntries) {
    try {
      const resolved = resolveSqlTagForJournalEntry(entry.tag, sqlTags);
      if (!resolved) {
        errors.push(
          `Journal entry "${entry.tag}" has no matching ${drizzleDir}/NNNN_*.sql file.`,
        );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const uncovered = sqlTags.filter(
    (tag) => !sqlTagCoveredByJournal(tag, journalEntries, sqlTags),
  );
  for (const tag of uncovered) {
    errors.push(
      `${drizzleDir}/${tag}.sql is not listed in ${journalPath} — db:prepare will skip it on deploy.`,
    );
  }

  for (const path of stagedNewPaths) {
    const tag = path.replace(/^drizzle\//, "").replace(/\.sql$/, "");
    if (!sqlTagCoveredByJournal(tag, journalEntries, sqlTags)) {
      errors.push(
        `Staged new migration ${path} requires a matching entry in ${journalPath} (tag: "${tag}").`,
      );
    }
  }

  if (errors.length === 0) {
    return { ok: true };
  }

  return { ok: false, errors: [...new Set(errors)] };
}
