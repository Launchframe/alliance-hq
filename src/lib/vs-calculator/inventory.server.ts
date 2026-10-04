import "server-only";

import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { VsCalculatorDayNumber } from "@/lib/vs-calculator/vs-calendar.shared";
import type { VsPointsByDay } from "@/lib/vs-calculator/catalog-seed.shared";
import type { VsCatalogItemDef } from "@/lib/vs-calculator/capacity.shared";

export async function listActiveVsCatalogDefs(): Promise<VsCatalogItemDef[]> {
  const db = getDb();
  const rows = await db
    .select({
      slug: schema.vsInventoryItemDefs.slug,
      displayName: schema.vsInventoryItemDefs.displayName,
      pointsByDay: schema.vsInventoryItemDefs.pointsByDay,
      sortOrder: schema.vsInventoryItemDefs.sortOrder,
    })
    .from(schema.vsInventoryItemDefs)
    .where(eq(schema.vsInventoryItemDefs.status, "active"))
    .orderBy(asc(schema.vsInventoryItemDefs.sortOrder));

  return rows.map((row) => ({
    slug: row.slug,
    displayName: row.displayName,
    pointsByDay: normalizePointsByDay(row.pointsByDay),
    sortOrder: row.sortOrder,
  }));
}

function normalizePointsByDay(
  raw: Record<string, number> | null,
): VsPointsByDay {
  if (!raw) return {};
  const out: VsPointsByDay = {};
  for (const [key, value] of Object.entries(raw)) {
    const day = Number(key);
    if (day >= 1 && day <= 5 && Number.isFinite(value) && value > 0) {
      out[day as VsCalculatorDayNumber] = value;
    }
  }
  return out;
}
