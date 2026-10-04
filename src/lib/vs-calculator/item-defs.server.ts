import "server-only";

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { putObject } from "@/lib/storage";
import { computeIconPhashFromBuffer } from "@/lib/vs-calculator/bag-ocr/compute-icon-phash.server";
import type { VsPointsByDay } from "@/lib/vs-calculator/catalog-seed.shared";
import { vsInventoryIconStorageKey } from "@/lib/vs-calculator/vs-inventory-icon.shared";

export type VsItemDefRow = {
  id: string;
  slug: string;
  displayName: string;
  pointsByDay: Record<string, number>;
  status: string;
  iconTemplateUrl: string | null;
  iconPhash: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

export function isValidVsItemSlug(slug: string): boolean {
  return SLUG_RE.test(slug) && slug.length <= 64;
}

function normalizePointsByDay(raw: Record<string, unknown>): VsPointsByDay {
  const out: VsPointsByDay = {};
  for (const [key, value] of Object.entries(raw)) {
    const day = Number(key);
    const points = Number(value);
    if (day >= 1 && day <= 5 && Number.isFinite(points) && points > 0) {
      out[day as 1 | 2 | 3 | 4 | 5] = points;
    }
  }
  return out;
}

export async function listVsInventoryItemDefs(input?: {
  status?: string;
}): Promise<VsItemDefRow[]> {
  const db = getDb();
  const query = db
    .select()
    .from(schema.vsInventoryItemDefs)
    .orderBy(asc(schema.vsInventoryItemDefs.sortOrder));

  const rows = input?.status
    ? await query.where(eq(schema.vsInventoryItemDefs.status, input.status))
    : await query;

  return rows.map((row) => ({
    ...row,
    pointsByDay: row.pointsByDay ?? {},
  }));
}

export async function getVsInventoryItemDef(
  id: string,
): Promise<VsItemDefRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.vsInventoryItemDefs)
    .where(eq(schema.vsInventoryItemDefs.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row, pointsByDay: row.pointsByDay ?? {} };
}

export async function createVsInventoryItemDef(input: {
  slug: string;
  displayName: string;
  pointsByDay: Record<string, unknown>;
  status?: string;
  sortOrder?: number;
}): Promise<VsItemDefRow> {
  if (!isValidVsItemSlug(input.slug)) {
    throw new Error("Invalid slug.");
  }
  const db = getDb();
  const now = new Date();
  const id = nanoid(16);
  await db.insert(schema.vsInventoryItemDefs).values({
    id,
    slug: input.slug,
    displayName: input.displayName.trim(),
    pointsByDay: normalizePointsByDay(input.pointsByDay),
    status: input.status ?? "draft",
    sortOrder: input.sortOrder ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getVsInventoryItemDef(id);
  if (!created) throw new Error("Failed to create item def.");
  return created;
}

export async function updateVsInventoryItemDef(
  id: string,
  patch: {
    slug?: string;
    displayName?: string;
    pointsByDay?: Record<string, unknown>;
    status?: string;
    sortOrder?: number;
  },
): Promise<VsItemDefRow | null> {
  const existing = await getVsInventoryItemDef(id);
  if (!existing) return null;

  if (patch.slug != null && !isValidVsItemSlug(patch.slug)) {
    throw new Error("Invalid slug.");
  }

  const db = getDb();
  const now = new Date();
  await db
    .update(schema.vsInventoryItemDefs)
    .set({
      ...(patch.slug != null ? { slug: patch.slug } : {}),
      ...(patch.displayName != null
        ? { displayName: patch.displayName.trim() }
        : {}),
      ...(patch.pointsByDay != null
        ? { pointsByDay: normalizePointsByDay(patch.pointsByDay) }
        : {}),
      ...(patch.status != null ? { status: patch.status } : {}),
      ...(patch.sortOrder != null ? { sortOrder: patch.sortOrder } : {}),
      updatedAt: now,
    })
    .where(eq(schema.vsInventoryItemDefs.id, id));

  return getVsInventoryItemDef(id);
}

export async function uploadVsInventoryItemIcon(input: {
  defId: string;
  iconPng: Buffer;
}): Promise<VsItemDefRow | null> {
  const def = await getVsInventoryItemDef(input.defId);
  if (!def) return null;

  const storageKey = vsInventoryIconStorageKey(def.slug);
  const iconPhash = await computeIconPhashFromBuffer(input.iconPng);
  await putObject(storageKey, input.iconPng);

  const db = getDb();
  const now = new Date();
  await db
    .update(schema.vsInventoryItemDefs)
    .set({
      iconTemplateUrl: storageKey,
      iconPhash,
      updatedAt: now,
    })
    .where(eq(schema.vsInventoryItemDefs.id, input.defId));

  return getVsInventoryItemDef(input.defId);
}
