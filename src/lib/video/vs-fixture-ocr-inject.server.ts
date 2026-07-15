import "server-only";

import { loadVsFixtureById } from "@/lib/video/vs-fixture-library.server";
import type { OcrEntry } from "@/lib/video/normalize-rows";
import type { VsScoreFixtureRow } from "@/lib/video/vs-fixture-types";

/**
 * Load fixture rows and return them as OcrEntry[] suitable for the parsing
 * pipeline. Returns null if the fixture is not found.
 */
export async function loadFixtureAsOcrEntries(
  fixtureId: string,
  fixtureDayIndex: number | null,
): Promise<OcrEntry[] | null> {
  const template = await loadVsFixtureById(fixtureId);
  if (!template) return null;

  let rows: VsScoreFixtureRow[];

  if (template.kind === "week") {
    const dayIdx = fixtureDayIndex ?? 0;
    const day = template.days[dayIdx];
    if (!day) return null;
    rows = day.rows;
  } else {
    rows = template.rows;
  }

  return rows.map((row, index) => ({
    name: row.name,
    score: String(row.score),
    rank: row.rank ?? index + 1,
    _sourceFrameIndex: 0,
  }));
}
