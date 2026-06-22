#!/usr/bin/env node

import { validateMigrationJournal } from "../lib/migration-journal.mjs";

const result = validateMigrationJournal();

if (result.ok) {
  console.log("Migration journal OK");
  process.exit(0);
}

console.error("Migration journal validation failed:\n");
for (const error of result.errors) {
  console.error(`  - ${error}`);
}
console.error(
  "\nHand-written SQL: add drizzle/NNNN_name.sql and append { tag: \"NNNN_name\" } to drizzle/meta/_journal.json.",
);
console.error("Schema from drizzle-kit: run npm run db:generate (updates both).");
process.exit(1);
