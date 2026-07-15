import "server-only";

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type {
  VsScoreDayTemplate,
  VsScoreTemplate,
  VsScoreWeekTemplate,
} from "@/lib/video/vs-fixture-types";

function committedLibraryDir(): string {
  return path.join(
    process.cwd(),
    "src/lib/video/__ocr_fixtures__/vs-library",
  );
}

function loadCommittedIndex(): string[] {
  const indexPath = path.join(committedLibraryDir(), "index.json");
  if (!fs.existsSync(indexPath)) return [];
  return JSON.parse(fs.readFileSync(indexPath, "utf8")) as string[];
}

function loadCommittedTemplate(id: string): VsScoreTemplate | null {
  const dir = committedLibraryDir();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const filePath = path.join(dir, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as VsScoreTemplate;
      if (data.id === id) return data;
    } catch {
      continue;
    }
  }
  return null;
}

function loadAllCommittedTemplates(): VsScoreTemplate[] {
  const ids = loadCommittedIndex();
  const templates: VsScoreTemplate[] = [];
  for (const id of ids) {
    const t = loadCommittedTemplate(id);
    if (t) templates.push(t);
  }
  return templates;
}

function dbRowToTemplate(
  row: typeof schema.hqVsScoreFixtureTemplates.$inferSelect,
): VsScoreTemplate {
  const payload = row.payload as Record<string, unknown>;
  const base = {
    id: row.id,
    name: row.name,
    tags: row.tags ?? [],
    allianceTag: row.allianceTag ?? undefined,
  };

  if (row.kind === "week") {
    return {
      ...base,
      kind: "week",
      sourceWeekStart: (payload.sourceWeekStart as string) ?? "",
      scrapedAt: row.createdAt.toISOString(),
      days: (payload.days as VsScoreWeekTemplate["days"]) ?? [],
    };
  }

  return {
    ...base,
    kind: "day",
    sourceRecordedDate: (payload.sourceRecordedDate as string) ?? "",
    scrapedAt: row.createdAt.toISOString(),
    rows: (payload.rows as VsScoreDayTemplate["rows"]) ?? [],
  };
}

/** Load merged library: committed ∪ workspace (workspace wins on same id). */
export async function loadVsFixtureLibrary(): Promise<VsScoreTemplate[]> {
  const committed = loadAllCommittedTemplates();

  const db = getDb();
  const dbRows = await db
    .select()
    .from(schema.hqVsScoreFixtureTemplates)
    .orderBy(schema.hqVsScoreFixtureTemplates.createdAt);

  const workspace = dbRows.map(dbRowToTemplate);
  const byId = new Map<string, VsScoreTemplate>();
  for (const t of committed) byId.set(t.id, t);
  for (const t of workspace) byId.set(t.id, t);

  return Array.from(byId.values());
}

/** Load a single template by id (workspace first, then committed). */
export async function loadVsFixtureById(
  id: string,
): Promise<VsScoreTemplate | null> {
  const db = getDb();
  const [dbRow] = await db
    .select()
    .from(schema.hqVsScoreFixtureTemplates)
    .where(eq(schema.hqVsScoreFixtureTemplates.id, id))
    .limit(1);
  if (dbRow) return dbRowToTemplate(dbRow);

  return loadCommittedTemplate(id);
}
