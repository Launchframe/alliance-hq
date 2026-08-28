import "server-only";

import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { getCommanderIdForMember } from "@/lib/thp/repository";
import type { VsCalculatorDayNumber } from "@/lib/vs-calculator/vs-calendar.shared";
import type { VsPointsByDay } from "@/lib/vs-calculator/catalog-seed.shared";
import type { VsCatalogItemDef, VsInventoryQuantities } from "@/lib/vs-calculator/capacity.shared";
import { resolveShinyWeekdaysForAlliance } from "@/lib/vs-calculator/shiny-sync.server";

export type VsInventoryEventReason =
  | "manual"
  | "ocr"
  | "vs_burn"
  | "clear";

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

export async function resolveCommanderForVsCalculator(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<string | null> {
  const link = await getHqMemberLinkForUser(input.allianceId, input.hqUserId);
  if (!link) return null;
  return getCommanderIdForMember(input.allianceId, link.ashedMemberId);
}

export async function getCommanderVsInventory(
  commanderId: string,
): Promise<VsInventoryQuantities> {
  const db = getDb();
  const [row] = await db
    .select({ quantities: schema.commanderVsInventories.quantities })
    .from(schema.commanderVsInventories)
    .where(eq(schema.commanderVsInventories.commanderId, commanderId))
    .limit(1);
  return row?.quantities ?? {};
}

export async function putCommanderVsInventory(input: {
  commanderId: string;
  quantities: VsInventoryQuantities;
  hqUserId: string;
  reason?: VsInventoryEventReason;
}): Promise<VsInventoryQuantities> {
  const sanitized = sanitizeQuantities(input.quantities);
  const db = getDb();
  const existing = await getCommanderVsInventory(input.commanderId);
  const now = new Date();

  await db
    .insert(schema.commanderVsInventories)
    .values({
      commanderId: input.commanderId,
      quantities: sanitized,
      reportedByHqUserId: input.hqUserId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.commanderVsInventories.commanderId,
      set: {
        quantities: sanitized,
        reportedByHqUserId: input.hqUserId,
        updatedAt: now,
      },
    });

  await recordInventoryDiffEvents({
    commanderId: input.commanderId,
    before: existing,
    after: sanitized,
    reason: input.reason ?? "manual",
  });

  return sanitized;
}

export async function adjustCommanderVsInventoryItem(input: {
  commanderId: string;
  slug: string;
  delta: number;
  hqUserId: string;
  reason?: VsInventoryEventReason;
}): Promise<VsInventoryQuantities> {
  const existing = await getCommanderVsInventory(input.commanderId);
  const nextQty = Math.max(0, (existing[input.slug] ?? 0) + input.delta);
  const next = { ...existing, [input.slug]: nextQty };
  if (nextQty === 0) {
    delete next[input.slug];
  }
  return putCommanderVsInventory({
    commanderId: input.commanderId,
    quantities: next,
    hqUserId: input.hqUserId,
    reason: input.reason ?? "manual",
  });
}

export async function clearCommanderVsInventoryItem(input: {
  commanderId: string;
  slug: string;
  hqUserId: string;
}): Promise<VsInventoryQuantities> {
  const existing = await getCommanderVsInventory(input.commanderId);
  if (!(input.slug in existing)) return existing;
  const next = { ...existing };
  delete next[input.slug];
  return putCommanderVsInventory({
    commanderId: input.commanderId,
    quantities: next,
    hqUserId: input.hqUserId,
    reason: "vs_burn",
  });
}

export async function loadShinyWeekdaysForAlliance(
  allianceId: string,
): Promise<[number, number] | null> {
  return resolveShinyWeekdaysForAlliance(allianceId);
}

function sanitizeQuantities(
  quantities: VsInventoryQuantities,
): VsInventoryQuantities {
  const out: VsInventoryQuantities = {};
  for (const [slug, raw] of Object.entries(quantities)) {
    const qty = Math.floor(Number(raw));
    if (!slug.trim() || !Number.isFinite(qty) || qty <= 0) continue;
    out[slug] = qty;
  }
  return out;
}

async function recordInventoryDiffEvents(input: {
  commanderId: string;
  before: VsInventoryQuantities;
  after: VsInventoryQuantities;
  reason: VsInventoryEventReason;
}): Promise<void> {
  const slugs = new Set([
    ...Object.keys(input.before),
    ...Object.keys(input.after),
  ]);
  const db = getDb();
  const events: Array<{
    id: string;
    commanderId: string;
    itemSlug: string;
    delta: number;
    qtyAfter: number;
    reason: string;
  }> = [];

  for (const slug of slugs) {
    const beforeQty = input.before[slug] ?? 0;
    const afterQty = input.after[slug] ?? 0;
    if (beforeQty === afterQty) continue;
    events.push({
      id: nanoid(),
      commanderId: input.commanderId,
      itemSlug: slug,
      delta: afterQty - beforeQty,
      qtyAfter: afterQty,
      reason: input.reason,
    });
  }

  if (events.length === 0) return;
  await db.insert(schema.commanderVsInventoryEvents).values(events);
}
