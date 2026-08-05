import "server-only";

import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  bagCellBounds,
  bagCellCount,
  bagIconRegion,
  bagQuantityRegion,
  inferBagGridLayout,
} from "@/lib/vs-calculator/bag-ocr/bag-grid.shared";
import type { BagParseResult } from "@/lib/vs-calculator/bag-ocr/bag-ocr.shared";
import {
  computeIconPhashFromBuffer,
  extractImageRegion,
  readImageDimensions,
} from "@/lib/vs-calculator/bag-ocr/compute-icon-phash.server";
import { matchIconPhash } from "@/lib/vs-calculator/bag-ocr/match-templates.shared";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";

const QTY_OCR_CONFIG = {
  mode: "roster-ocr" as const,
  tesseractPsm: 7,
  minWordConfidence: 0,
};

function parseQuantityFromOcrText(text: string): number | null {
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) return null;
  const qty = Number.parseInt(digits, 10);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return qty;
}

async function ocrCellQuantity(qtyBuffer: Buffer): Promise<number | null> {
  const lines = await runTesseract(qtyBuffer, QTY_OCR_CONFIG);
  const joined = lines.map((line) => line.text).join(" ");
  return parseQuantityFromOcrText(joined);
}

export async function loadActiveIconTemplates(): Promise<
  Array<{
    slug: string;
    displayName: string;
    iconPhash: string;
  }>
> {
  const db = getDb();
  const rows = await db
    .select({
      slug: schema.vsInventoryItemDefs.slug,
      displayName: schema.vsInventoryItemDefs.displayName,
      iconPhash: schema.vsInventoryItemDefs.iconPhash,
    })
    .from(schema.vsInventoryItemDefs)
    .where(eq(schema.vsInventoryItemDefs.status, "active"))
    .orderBy(asc(schema.vsInventoryItemDefs.sortOrder));

  return rows
    .filter((row) => row.iconPhash)
    .map((row) => ({
      slug: row.slug,
      displayName: row.displayName,
      iconPhash: row.iconPhash!,
    }));
}

export async function parseBagImage(imageBuffer: Buffer): Promise<BagParseResult> {
  const t0 = Date.now();
  const { width, height } = await readImageDimensions(imageBuffer);
  if (width < 32 || height < 32) {
    return {
      matched: [],
      unknown: [],
      grid: { cols: 0, rows: 0 },
      durationMs: Date.now() - t0,
    };
  }

  const templates = await loadActiveIconTemplates();
  const layout = inferBagGridLayout(width, height);
  const totalCells = bagCellCount(layout);

  const matched: BagParseResult["matched"] = [];
  const unknown: BagParseResult["unknown"] = [];
  const qtyBySlug = new Map<string, number>();

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
    const bounds = bagCellBounds(layout, cellIndex);
    const iconBounds = bagIconRegion(bounds);
    const qtyBounds = bagQuantityRegion(bounds);

    let iconBuffer: Buffer;
    let qtyBuffer: Buffer;
    try {
      iconBuffer = await extractImageRegion(imageBuffer, iconBounds);
      qtyBuffer = await extractImageRegion(imageBuffer, qtyBounds);
    } catch {
      continue;
    }

    const cellPhash = await computeIconPhashFromBuffer(iconBuffer);
    const match = matchIconPhash(cellPhash, templates);
    const quantity = await ocrCellQuantity(qtyBuffer);

    if (!match) {
      if (quantity != null) {
        unknown.push({ cellIndex, quantity });
      }
      continue;
    }

    if (quantity == null) continue;

    const prev = qtyBySlug.get(match.slug) ?? 0;
    qtyBySlug.set(match.slug, prev + quantity);

    matched.push({
      cellIndex,
      slug: match.slug,
      displayName: match.displayName,
      quantity,
      confidence: match.confidence,
    });
  }

  const mergedMatched = [...qtyBySlug.entries()].map(([slug, quantity]) => {
    const sample = matched.find((row) => row.slug === slug)!;
    return {
      cellIndex: sample.cellIndex,
      slug,
      displayName: sample.displayName,
      quantity,
      confidence: sample.confidence,
    };
  });

  return {
    matched: mergedMatched.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    unknown,
    grid: { cols: layout.cols, rows: layout.rows },
    durationMs: Date.now() - t0,
  };
}
