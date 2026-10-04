import "server-only";

import sharp from "sharp";

import {
  runTesseract,
  terminateTesseractWorker,
} from "@/lib/members/roster-ocr/tesseract";
import { detectCardBands } from "@/lib/video/warzone-card-detect";
import { fuzzyWarzoneNameKey } from "@/lib/video/event-evidence-dedup.shared";
import type { OcrAllFramesResult } from "@/lib/video/ocr-pipeline";
import type { VideoOcrProgressCallback } from "@/lib/video/ocr-provider.shared";
import type { OcrEntry } from "@/lib/video/normalize-rows";
import {
  warzoneTargetFormat,
  type WarzoneCropRegion,
  type WarzoneEvidenceTargetId,
  type WarzoneFrame,
  type WarzoneFrameResult,
  type WarzoneLeaderboardEntry,
  type WarzonePollEntry,
  type WarzoneUploadFormat,
} from "@/lib/video/warzone-evidence.shared";

type Bbox = { x0: number; y0: number; x1: number; y1: number };

type Line = { text: string; bbox?: Bbox | null };

const HEADER_LEADERBOARD = /\branking\b/iu;
const HEADER_COMMANDER = /\bcommander\b/iu;
const HEADER_POINTS = /\bpoints\b/iu;
const HEADER_VOTING = /\bvoting\s+members?\b/iu;
const POLL_OPTION_PATTERN = /chose\s+option\s*(\d)/iu;
const POLL_OPTION_ANY = /\boption\s*(\d)\b/iu;
// Tesseract frequently splits "…chose option 1 in this vote" across two lines
// ("chose opt" + "n 1in this vote"); allow the mangled fragment form.
const POLL_OPTION_FRAGMENT = /chose\s+opt\w*\s+n?\s*([12])\s*in/iu;
const ALLIANCE_TAG_PATTERN = /\[([A-Za-z0-9]{2,6})\]/;
const POWER_PATTERN = /\bpower\s*[:：]?\s*([\d,.\s]*\d[\d,.\s]*[KMkm]?)/iu;
const LEVEL_PATTERN = /\blv\.\s*\d+/iu;
const RANK_BADGE_PATTERN = /\bR[1-5]\b/u;

function toCrop(bbox: Bbox, width: number, height: number): WarzoneCropRegion {
  return {
    left: Math.max(0, Math.min(1, bbox.x0 / width)),
    top: Math.max(0, Math.min(1, bbox.y0 / height)),
    width: Math.max(0, Math.min(1, (bbox.x1 - bbox.x0) / width)),
    height: Math.max(0, Math.min(1, (bbox.y1 - bbox.y0) / height)),
  };
}

function unionCrop(
  boxes: readonly Bbox[],
  width: number,
  height: number,
): WarzoneCropRegion | null {
  if (boxes.length === 0) return null;
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const y0 = Math.min(...boxes.map((b) => b.y0));
  const x1 = Math.max(...boxes.map((b) => b.x1));
  const y1 = Math.max(...boxes.map((b) => b.y1));
  return toCrop({ x0, y0, x1, y1 }, width, height);
}

/**
 * Layout detection: a RANKING header with Commander/Points columns is a
 * leaderboard; a foreground "VOTING MEMBERS" dialog with an option header
 * is a poll frame. Anything else is unknown.
 */
export function detectWarzoneLayout(
  lines: readonly Line[],
): "leaderboard" | "poll" | "unknown" {
  const texts = lines.map((line) => line.text);
  const hasVoting = texts.some((text) => HEADER_VOTING.test(text));
  if (hasVoting) return "poll";
  const hasRanking = texts.some((text) => HEADER_LEADERBOARD.test(text));
  const hasCommander = texts.some((text) => HEADER_COMMANDER.test(text));
  const hasPoints = texts.some((text) => HEADER_POINTS.test(text));
  if (hasRanking && (hasCommander || hasPoints)) return "leaderboard";
  return "unknown";
}

/**
 * Option number from a poll frame's "chose option N" header. Searched near
 * the VOTING MEMBERS header first; falls back to any `option N` text above
 * the dialog. Returns null when unreadable — never guesses.
 */
/**
 * Merge OCR lines that share a y-band into one text row (union bbox).
 * Tesseract splits dialog headers and multi-column rows into fragments at
 * the same baseline; matching on the merged text survives the split.
 */
function mergeLinesByBaseline(lines: readonly Line[]): Line[] {
  const withBox = lines.filter((line): line is Line & { bbox: Bbox } => !!line.bbox);
  const sorted = [...withBox].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const clusters: Array<{ lines: Array<Line & { bbox: Bbox }>; yCenter: number }> = [];
  for (const line of sorted) {
    const center = (line.bbox.y0 + line.bbox.y1) / 2;
    const height = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const cluster = clusters.find((c) => Math.abs(c.yCenter - center) <= Math.max(height * 0.6, 4));
    if (cluster) {
      cluster.lines.push(line);
      cluster.yCenter =
        (cluster.yCenter * (cluster.lines.length - 1) + center) / cluster.lines.length;
    } else {
      clusters.push({ lines: [line], yCenter: center });
    }
  }
  return clusters.map((cluster) => {
    const parts = [...cluster.lines].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const x0 = Math.min(...parts.map((p) => p.bbox.x0));
    const y0 = Math.min(...parts.map((p) => p.bbox.y0));
    const x1 = Math.max(...parts.map((p) => p.bbox.x1));
    const y1 = Math.max(...parts.map((p) => p.bbox.y1));
    return { text: parts.map((p) => p.text).join(" "), bbox: { x0, y0, x1, y1 } };
  });
}

export function detectPollOption(lines: readonly Line[]): 1 | 2 | null {
  const merged = mergeLinesByBaseline(lines);
  const voting = merged.find((line) => HEADER_VOTING.test(line.text));
  const nearHeader = voting?.bbox
    ? merged.filter(
        (line) =>
          line.bbox &&
          line.bbox.y0 >= voting.bbox!.y0 - (voting.bbox!.y1 - voting.bbox!.y0) * 4 &&
          line.bbox.y1 <= voting.bbox!.y1 + (voting.bbox!.y1 - voting.bbox!.y0) * 3,
      )
    : merged;
  for (const scope of [nearHeader, merged]) {
    for (const line of scope) {
      const direct =
        line.text.match(POLL_OPTION_PATTERN) ??
        line.text.match(POLL_OPTION_FRAGMENT);
      const loose = direct ?? line.text.match(POLL_OPTION_ANY);
      const digit = loose?.[1];
      if (digit === "1" || digit === "2") return Number(digit) as 1 | 2;
    }
  }
  return null;
}

/**
 * Poll dialog rows: a member name followed by `Power:<digits>` and `LV.…`.
 * Power, LV and R badges are stripped and never become scores. Name-only
 * lines inside the dialog are ignored — a row requires the Power anchor so
 * background chat text cannot leak in.
 */
export function parseWarzonePollLines(
  lines: readonly Line[],
  width: number,
  height: number,
): { option: 1 | 2 | null; entries: WarzonePollEntry[] } {
  const voting = lines.find(
    (line) => HEADER_VOTING.test(line.text) && line.bbox,
  );
  const option = detectPollOption(lines);
  if (!voting?.bbox) return { option, entries: [] };

  const headerHeight = Math.max(1, voting.bbox.y1 - voting.bbox.y0);
  const dialogTop = voting.bbox.y0;
  const entries: WarzonePollEntry[] = [];

  const cleanName = (text: string): string => {
    const scrubbed = text
      .replace(RANK_BADGE_PATTERN, " ")
      .replace(LEVEL_PATTERN, " ")
      .replace(POWER_PATTERN, " ")
      .replace(/\s+/g, " ")
      .trim();
    // Leading avatar/badge fragments ("[I 8 @", "5", "n3", "@/", "i &") are
    // never part of the name — drop leading tokens that are not ≥3 chars of
    // letters/digits, then drop noise tokens with no vowel/digit.
    return dropNonWordTokens(
      stripGlyphPrefixTokens(scrubbed),
    )
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .trim();
  };

  for (const line of lines) {
    if (!line.bbox || line.bbox.y0 <= dialogTop) continue;
    const power = line.text.match(POWER_PATTERN);
    if (!power) continue;
    if (line.bbox.y0 - dialogTop < headerHeight * 0.5) continue;
    const powerHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);

    const beforePower = cleanName(line.text.slice(0, power.index ?? 0));
    if (isPlausibleMemberName(beforePower) && !POLL_HEADER_NAME_NOISE.test(beforePower)) {
      // Same-line form: "Name … Power:123 LV.35".
      entries.push({ name: beforePower, crop: toCrop(line.bbox, width, height) });
      continue;
    }

    // Two-line form (real stills): the member name sits on the line directly
    // above the Power/LV row, roughly in the same x range.
    const powerBox = line.bbox;
    const nameLine = lines
      .filter(
        (other) =>
          other !== line &&
          other.bbox &&
          other.bbox.y1 <= powerBox.y1 &&
          other.bbox.y1 >= powerBox.y0 - powerHeight * 2.5 &&
          /[\p{L}]/u.test(other.text) &&
          !POWER_PATTERN.test(other.text) &&
          !LEVEL_PATTERN.test(other.text) &&
          !HEADER_VOTING.test(other.text) &&
          Math.abs(other.bbox.x0 - powerBox.x0) <= width * 0.15,
      )
      .sort(
        (a, b) =>
          Math.abs(a.bbox!.x0 - powerBox.x0) - Math.abs(b.bbox!.x0 - powerBox.x0) ||
          b.bbox!.y1 - a.bbox!.y1,
      )[0];
    if (!nameLine?.bbox) continue;
    const name = cleanName(nameLine.text);
    if (!isPlausibleMemberName(name) || POLL_HEADER_NAME_NOISE.test(name)) {
      continue;
    }
    entries.push({
      name,
      crop: toCrop(
        {
          x0: Math.min(nameLine.bbox.x0, line.bbox.x0),
          y0: nameLine.bbox.y0,
          x1: Math.max(nameLine.bbox.x1, line.bbox.x1),
          y1: line.bbox.y1,
        },
        width,
        height,
      ),
    });
  }
  return { option, entries };
}

function scoreDigitsFrom(text: string): string | null {
  const trimmed = text.trim().replace(/[.,\s](?=\d{3}\b)/g, "");
  return /^\d+$/.test(trimmed) ? trimmed : null;
}

/**
 * Leaderboard rows: `rank | name | points` triples aligned on one y-band,
 * plus a `[TAG]alliance` line just below carrying the alliance tag. The
 * green pinned self row at the bottom is marked and deduplicated against
 * the in-list row for the same member.
 */
export function parseWarzoneLeaderboardLines(
  lines: readonly Line[],
  width: number,
  height: number,
  ownAllianceTag?: string | null,
): WarzoneLeaderboardEntry[] {
  const ranking = lines.find(
    (line) => HEADER_LEADERBOARD.test(line.text) && line.bbox,
  );
  if (!ranking?.bbox) return [];

  const commander = lines.find(
    (line) => HEADER_COMMANDER.test(line.text) && line.bbox,
  );
  const points = lines.find(
    (line) => HEADER_POINTS.test(line.text) && line.bbox,
  );
  const headerBottom = Math.max(
    ranking.bbox.y1,
    commander?.bbox?.y1 ?? 0,
    points?.bbox?.y1 ?? 0,
  );

  // Column anchors: Commander marks the name column start, Points the score
  // column. Fall back to proportional guesses when headers are unreadable.
  const nameColX = commander?.bbox?.x0 ?? width * 0.18;
  const pointsColX = points?.bbox?.x0 ?? width * 0.72;
  const rowHeightGuess =
    (commander?.bbox ? commander.bbox.y1 - commander.bbox.y0 : 0) || height * 0.035;

  const ownTag = ownAllianceTag?.replace(/[\[\]]/g, "").toUpperCase() ?? null;

  const yCenter = (bbox: Bbox) => (bbox.y0 + bbox.y1) / 2;
  const rankDigits = (text: string): number | null => {
    const match = text.trim().match(/^\(?\s*(\d{1,3})\s*[\]\)\|]*\s*$/u);
    if (!match) return null;
    const rank = Number(match[1]);
    return Number.isSafeInteger(rank) && rank >= 1 && rank <= 9999 ? rank : null;
  };

  // Column-typed tokens below the header row.
  const rankTokens = lines.filter(
    (line) =>
      line.bbox &&
      line.bbox.y1 > headerBottom + rowHeightGuess * 0.5 &&
      line.bbox.x1 < nameColX * 0.9 &&
      rankDigits(line.text) != null,
  );
  const scoreTokens = lines.filter(
    (line) =>
      line.bbox &&
      line.bbox.y1 > headerBottom + rowHeightGuess * 0.5 &&
      line.bbox.x0 >= pointsColX * 0.85 &&
      scoreDigitsFrom(line.text) != null,
  );
  const tagLines = lines.filter(
    (line) =>
      line.bbox &&
      line.bbox.y1 > headerBottom + rowHeightGuess * 0.5 &&
      ALLIANCE_TAG_PATTERN.test(line.text) &&
      line.bbox.x0 < pointsColX,
  );

  // Name fragments: letter-bearing lines inside the name column. Fragments
  // split across lines at the same baseline ("Any!" + "e KO") merge into one
  // candidate row.
  const nameFragments = lines.filter(
    (line) =>
      line.bbox &&
      line.bbox.y1 > headerBottom + rowHeightGuess * 0.5 &&
      !ALLIANCE_TAG_PATTERN.test(line.text) &&
      // The `[TAG] alliance name` line below each name is not a name —
      // brackets (even half-recognized) never appear in member names.
      !/[\[\]]/u.test(line.text) &&
      /[\p{L}]/u.test(line.text) &&
      !POWER_PATTERN.test(line.text) &&
      !LEVEL_PATTERN.test(line.text) &&
      line.bbox.x0 >= nameColX * 0.75 &&
      line.bbox.x0 <= pointsColX,
  );
  const nameRows: Line[] = [];
  for (const fragment of [...nameFragments].sort((a, b) => a.bbox!.y0 - b.bbox!.y0)) {
    const center = yCenter(fragment.bbox!);
    const height = Math.max(1, fragment.bbox!.y1 - fragment.bbox!.y0);
    const mergeable = nameRows.find(
      (row) =>
        Math.abs(yCenter(row.bbox!) - center) <= Math.max(height * 0.8, 5) &&
        fragment.bbox!.x0 - row.bbox!.x1 <= width * 0.1,
    );
    if (mergeable?.bbox) {
      mergeable.text =
        fragment.bbox!.x0 < mergeable.bbox.x0
          ? `${fragment.text} ${mergeable.text}`
          : `${mergeable.text} ${fragment.text}`;
      mergeable.bbox = {
        x0: Math.min(mergeable.bbox.x0, fragment.bbox!.x0),
        y0: Math.min(mergeable.bbox.y0, fragment.bbox!.y0),
        x1: Math.max(mergeable.bbox.x1, fragment.bbox!.x1),
        y1: Math.max(mergeable.bbox.y1, fragment.bbox!.y1),
      };
    } else {
      nameRows.push({ text: fragment.text, bbox: { ...fragment.bbox! } });
    }
  }

  const candidates: Array<{
    rank: number | null;
    name: string;
    nameLine: Line;
    tag: string | null;
    score: string | null;
    pinned: boolean;
    scoreToken: Line | null;
    rankToken: Line | null;
  }> = [];

  for (const line of nameRows) {
    const text = dropNonWordTokens(
      stripGlyphPrefixTokens(
        line.text.replace(/\[.*$/u, " ").replace(/\s+/g, " ").trim(),
      ),
    )
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
      .trim();
    const center = yCenter(line.bbox!);
    const rowBand = Math.max(rowHeightGuess * 1.6, line.bbox!.y1 - line.bbox!.y0);

    // Rank/points glyphs sit slightly off the name baseline; tolerate a full
    // row band rather than half, and prefer the closest candidate.
    const rankLine = rankTokens
      .filter((other) => Math.abs(yCenter(other.bbox!) - center) <= rowBand)
      .sort((a, b) => Math.abs(yCenter(a.bbox!) - center) - Math.abs(yCenter(b.bbox!) - center))[0];
    const pointsLine = scoreTokens
      .filter((other) => Math.abs(yCenter(other.bbox!) - center) <= rowBand)
      .sort((a, b) => Math.abs(yCenter(a.bbox!) - center) - Math.abs(yCenter(b.bbox!) - center))[0];
    const tagLine = tagLines.find(
      (other) =>
        other.bbox!.y0 > line.bbox!.y0 &&
        other.bbox!.y0 <= line.bbox!.y1 + rowBand * 1.4,
    );

    const tag = tagLine?.text.match(ALLIANCE_TAG_PATTERN)?.[1] ?? null;
    const score = pointsLine ? scoreDigitsFrom(pointsLine.text) : null;
    const rank = rankLine ? rankDigits(rankLine.text) : null;
    // A row with no score, rank, or alliance tag — or a cleaned name that
    // is only icon/glyph noise — is stray UI text, not a leaderboard entry.
    if (rank == null && score == null && tag == null) continue;
    if (!isPlausibleMemberName(text) && score == null) continue;
    const pinned = ownTag != null && tag != null && tag.toUpperCase() === ownTag
      ? center > height * 0.8
      : false;
    candidates.push({
      rank,
      name: text,
      nameLine: line,
      tag,
      score,
      pinned,
      scoreToken: pointsLine ?? null,
      rankToken: rankLine ?? null,
    });
  }

  // A score/rank glyph can belong to only one row — when a sub-line fragment
  // (e.g. an alliance name without brackets) and the real name both reach
  // the same token, keep the vertically closer name.
  for (const key of ["scoreToken", "rankToken"] as const) {
    const byToken = new Map<Line, typeof candidates>();
    for (const row of candidates) {
      const token = row[key];
      if (!token) continue;
      const group = byToken.get(token) ?? [];
      group.push(row);
      byToken.set(token, group);
    }
    for (const group of byToken.values()) {
      if (group.length < 2) continue;
      group.sort(
        (a, b) =>
          Math.abs(yCenter(a.nameLine.bbox!) - yCenter(b[key]!.bbox!)) -
          Math.abs(yCenter(b.nameLine.bbox!) - yCenter(a[key]!.bbox!)),
      );
      for (const loser of group.slice(1)) {
        const index = candidates.indexOf(loser);
        if (index >= 0) candidates.splice(index, 1);
      }
    }
  }

  // Foreign-tag rows are NOT dropped here — dedupeWarzoneEvidence filters
  // them only when the own tag was actually observed in the job, so a stale
  // stored tag can never silently discard correctly-read members.

  // Pinned self-row dedup: the same (name, score) tuple appearing twice —
  // the lower copy is the pinned duplicate.
  const seen = new Set<string>();
  const entries: WarzoneLeaderboardEntry[] = [];
  for (const row of candidates) {
    const key = `${row.name.toLowerCase()}|${row.score ?? "?"}`;
    if (row.pinned && seen.has(key)) continue;
    seen.add(key);
    entries.push({
      name: row.name,
      allianceTag: row.tag,
      actualScore: row.score,
      observedRank: row.rank,
      crop: row.nameLine.bbox ? toCrop(row.nameLine.bbox, width, height) : null,
      ...(row.pinned ? { pinned: true } : {}),
    });
  }
  return entries;
}

/** Parse one normalized frame into the typed Warzone frame contract. */
export function parseWarzoneFrameLines(
  lines: readonly Line[],
  width: number,
  height: number,
  options?: { ownAllianceTag?: string | null; format?: WarzoneUploadFormat },
): { frame: WarzoneFrame; safeCrop: WarzoneCropRegion | null; formatMismatch: boolean } {
  const detected = detectWarzoneLayout(lines);
  const format = options?.format ?? "auto";
  const formatMismatch =
    format !== "auto" && detected !== "unknown" && detected !== format;

  if (detected === "poll") {
    const { option, entries } = parseWarzonePollLines(lines, width, height);
    const voting = lines.find((line) => HEADER_VOTING.test(line.text));
    const headerBoxes = [
      voting?.bbox ?? null,
      ...entries
        .map((entry) => entry.crop)
        .filter((crop): crop is WarzoneCropRegion => crop != null)
        .map((crop) => ({
          x0: crop.left * width,
          y0: crop.top * height,
          x1: (crop.left + crop.width) * width,
          y1: (crop.top + crop.height) * height,
        })),
    ].filter((box): box is Bbox => box != null);
    return {
      frame: { kind: "poll", option, entries },
      safeCrop: unionCrop(headerBoxes, width, height),
      formatMismatch,
    };
  }

  if (detected === "leaderboard") {
    const entries = parseWarzoneLeaderboardLines(
      lines,
      width,
      height,
      options?.ownAllianceTag,
    );
    if (entries.length === 0) {
      return {
        frame: { kind: "unknown", reason: "leaderboard_no_rows" },
        safeCrop: null,
        formatMismatch,
      };
    }
    const headerBoxes = lines
      .filter(
        (line) =>
          line.bbox &&
          (HEADER_LEADERBOARD.test(line.text) ||
            HEADER_COMMANDER.test(line.text) ||
            HEADER_POINTS.test(line.text)),
      )
      .map((line) => line.bbox!);
    const rowBoxes = entries
      .map((entry) => entry.crop)
      .filter((crop): crop is WarzoneCropRegion => crop != null)
      .map((crop) => ({
        x0: crop.left * width,
        y0: crop.top * height,
        x1: (crop.left + crop.width) * width,
        y1: (crop.top + crop.height) * height,
      }));
    return {
      frame: { kind: "leaderboard", entries },
      safeCrop: unionCrop([...headerBoxes, ...rowBoxes], width, height),
      formatMismatch,
    };
  }

  return {
    frame: { kind: "unknown", reason: "layout_not_detected" },
    safeCrop: null,
    formatMismatch,
  };
}

/**
 * Map an Ashed extraction result (WARZONE_EVIDENCE_OCR_SCHEMA) onto the
 * same frame contract. Malformed payloads degrade to `unknown` rows —
 * never guessed.
 */
export function parseWarzoneExtractResult(raw: unknown): WarzoneFrame {
  if (raw == null || typeof raw !== "object") {
    return { kind: "unknown", reason: "empty_extract" };
  }
  const result = raw as {
    layout?: unknown;
    pollOption?: unknown;
    entries?: unknown;
  };
  const rows = Array.isArray(result.entries) ? result.entries : [];
  if (result.layout === "poll") {
    return {
      kind: "poll",
      option:
        result.pollOption === 1 || result.pollOption === 2
          ? result.pollOption
          : null,
      entries: rows
        .map((row): WarzonePollEntry | null => {
          const name =
            row != null && typeof row === "object"
              ? String((row as { name?: unknown }).name ?? "").trim()
              : "";
          return name ? { name, crop: null } : null;
        })
        .filter((row): row is WarzonePollEntry => row != null),
    };
  }
  if (result.layout === "leaderboard") {
    return {
      kind: "leaderboard",
      entries: rows
        .map((row): WarzoneLeaderboardEntry | null => {
          if (row == null || typeof row !== "object") return null;
          const record = row as Record<string, unknown>;
          const name = String(record.name ?? "").trim();
          if (!name) return null;
          const score =
            record.score == null ? null : String(record.score).trim();
          const rank =
            typeof record.observedRank === "number" &&
            Number.isSafeInteger(record.observedRank)
              ? record.observedRank
              : null;
          return {
            name,
            allianceTag:
              record.allianceTag == null ? null : String(record.allianceTag),
            actualScore: score && /^\d+$/.test(score) ? score : null,
            observedRank: rank,
            crop: null,
          } satisfies WarzoneLeaderboardEntry;
        })
        .filter((row): row is WarzoneLeaderboardEntry => row != null),
    };
  }
  return { kind: "unknown", reason: "unrecognized_layout" };
}

/** Canonical analysis width — every frame lands here so column and card geometry is resolution-independent. */
export const WARZONE_CANONICAL_WIDTH = 1400;

const DIGITS_WHITELIST = "0123456789";
const DIGITS_GROUPED_WHITELIST = "0123456789,.";

async function ocrRegionText(
  image: Buffer,
  region: { left: number; top: number; width: number; height: number },
  opts: { whitelist?: string; psm?: number } = {},
): Promise<{ text: string; confidence: number }> {
  const left = Math.max(0, Math.round(region.left));
  const top = Math.max(0, Math.round(region.top));
  const width = Math.round(region.width);
  const height = Math.round(region.height);
  if (width < 6 || height < 6) return { text: "", confidence: 0 };
  const crop = await sharp(image)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  const lines = await runTesseract(crop, {
    tesseractPsm: opts.psm ?? 7,
    charWhitelist: opts.whitelist,
    minWordConfidence: 0,
  });
  const text = lines.map((line) => line.text).join(" ").trim();
  const confidence =
    lines.length > 0
      ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length
      : 0;
  return { text, confidence };
}

function digitsOnly(text: string): string | null {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? digits : null;
}

/**
 * Drop leading glyph-noise tokens (badge/icon fragments like `n3`, `@/`,
 * `o/`) until the first plausible name token. A plausible name token is
 * ≥3 chars of letters/digits only.
 */
export function stripGlyphPrefixTokens(text: string): string {
  const tokens = text.trim().split(/\s+/);
  while (tokens.length > 1) {
    const head = tokens[0]!;
    const plausible = /^[\p{L}\p{N}]{3,}$/u.test(head);
    if (plausible) break;
    tokens.shift();
  }
  return tokens.join(" ");
}

/** Drop tokens with no vowel and no digit — OCR noise runs like `TTT LLTTTL TR`. */
function dropNonWordTokens(text: string): string {
  return text
    .split(/\s+/)
    .filter((token) => /[\p{N}aeiouyà-öø-ÿ]/iu.test(token))
    .join(" ")
    .trim();
}

/**
 * A cleaned name must contain at least one letter, be mostly letters, and
 * carry a ≥2-char alphanumeric token — otherwise it is icon/glyph noise,
 * not a member row.
 */
export function isPlausibleMemberName(name: string): boolean {
  const cleaned = name.trim();
  if (!/[\p{L}]/u.test(cleaned)) return false;
  if (!/[\p{L}\p{N}]{3,}/u.test(cleaned)) return false;
  return letterRatio(cleaned) >= 0.5;
}

/** Letter share of the non-space characters — low values are glyph noise. */
function letterRatio(text: string): number {
  const chars = text.replace(/\s+/g, "");
  if (!chars.length) return 0;
  const letters = (chars.match(/[\p{L}]/gu) ?? []).length;
  return letters / chars.length;
}

/**
 * Order-invariant consistency pass over a frame's leaderboard rows
 * (sorted top→bottom by card position): scores must be non-increasing
 * and ranks strictly increasing. A row violating either check is flagged
 * review-required — a wrong value is never silently accepted.
 */
export function flagNonMonotonicLeaderboard(
  entries: WarzoneLeaderboardEntry[],
): void {
  const ordered = [...entries]
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        (a.entry.crop?.top ?? 0) - (b.entry.crop?.top ?? 0) ||
        a.index - b.index,
    );
  let maxRankRow: WarzoneLeaderboardEntry | null =
    ordered[0]?.entry ?? null;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!.entry;
    const cur = ordered[i]!.entry;
    if (prev.actualScore != null && cur.actualScore != null) {
      try {
        if (BigInt(cur.actualScore) > BigInt(prev.actualScore)) {
          prev.reviewReason = prev.reviewReason ?? "score_not_monotonic";
          cur.reviewReason = cur.reviewReason ?? "score_not_monotonic";
        }
      } catch {
        // Non-numeric residue — both scores are canonical digits or null.
      }
    }
    // A rank must exceed every rank above it, not only the nearest — a
    // truncated leading digit (78 → 7) slips past adjacent comparison.
    if (
      maxRankRow != null &&
      cur.observedRank != null &&
      cur.observedRank <= (maxRankRow.observedRank ?? 0)
    ) {
      cur.reviewReason = cur.reviewReason ?? "rank_not_increasing";
    }
    if (
      cur.observedRank != null &&
      cur.observedRank > (maxRankRow?.observedRank ?? 0)
    ) {
      maxRankRow = cur;
    }
  }
  // Pairwise vote: a rank that disagrees with the ordering of the majority
  // of its peers is a misread even when it never meets a larger rank above
  // (e.g. a truncated 52 → 28 sitting at the top).
  const ranked = ordered
    .map((o) => o.entry)
    .filter((e) => e.observedRank != null);
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i]!;
    let violations = 0;
    for (let j = 0; j < ranked.length; j++) {
      if (i === j) continue;
      const other = ranked[j]!;
      const outOfOrder =
        j < i
          ? other.observedRank! >= row.observedRank!
          : other.observedRank! <= row.observedRank!;
      if (outOfOrder) violations++;
    }
    if (violations * 2 > ranked.length - 1) {
      row.reviewReason = row.reviewReason ?? "rank_not_increasing";
    }
  }
  // Digit-count outlier: scores on one leaderboard share a magnitude, so a
  // value two orders of magnitude shorter than the median is a clipped or
  // truncated read, not a real score.
  const digitCounts = ordered
    .map((o) => o.entry.actualScore?.length)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const medianDigits = digitCounts[Math.floor(digitCounts.length / 2)] ?? 0;
  if (medianDigits >= 4) {
    for (const o of ordered) {
      const len = o.entry.actualScore?.length;
      if (len != null && len <= medianDigits - 2) {
        o.entry.reviewReason = o.entry.reviewReason ?? "score_digit_anomaly";
      }
    }
  }
}

type CardOcrContext = {
  /** Normalized (canonical-width) PNG the region crops are taken from. */
  png: Buffer;
  raw: Uint8Array | Buffer;
  channels: number;
  width: number;
  height: number;
};

async function parseLeaderboardFromCards(
  ctx: CardOcrContext,
  lines: readonly Line[],
  ownAllianceTag: string | null | undefined,
  opts?: { scanWholeFrame?: boolean },
): Promise<WarzoneLeaderboardEntry[]> {
  const { width, height } = ctx;
  const ranking = lines.find(
    (line) => HEADER_LEADERBOARD.test(line.text) && line.bbox,
  );
  if (!ranking?.bbox && !opts?.scanWholeFrame) return [];
  const commander = lines.find(
    (line) => HEADER_COMMANDER.test(line.text) && line.bbox,
  );
  const points = lines.find(
    (line) => HEADER_POINTS.test(line.text) && line.bbox,
  );
  const headerBottom = Math.max(
    ranking?.bbox?.y1 ?? 0,
    commander?.bbox?.y1 ?? 0,
    points?.bbox?.y1 ?? 0,
  );

  const cards = detectCardBands(ctx.raw, ctx.channels, width, height, {
    x0: width * 0.02,
    x1: width * 0.98,
    y0: headerBottom + 2,
    y1: height,
  });
  if (process.env.WZ_DEBUG_CARDS) {
    console.log(
      `[wz-cards] headerBottom=${headerBottom} cards=${cards.length}`,
      cards.map((c) => `${c.y0}-${c.y1}`).join(","),
    );
  }
  if (cards.length === 0) return [];

  const ownTag =
    ownAllianceTag?.replace(/[\[\]]/g, "").toUpperCase() ?? null;
  const entries: WarzoneLeaderboardEntry[] = [];

  const defaultPointsX = points?.bbox?.x0 ?? null;
  const defaultNameX = commander?.bbox?.x0 ?? null;

  for (const card of cards) {
    const h = card.y1 - card.y0;
    const inCard = lines.filter(
      (line) =>
        line.bbox &&
        line.bbox.y0 >= card.y0 - 2 &&
        line.bbox.y1 <= card.y1 + 2,
    );
    const midY = card.y0 + h * 0.5;

    // Column anchors from the OCR'd tokens *inside this card*: score digits
    // on the right, rank digits on the left, name glyphs in between. Header
    // columns are only a fallback — the game's right-aligned numbers extend
    // left of the Points label, so fixed fractions mis-crop them.
    const scoreLines = inCard.filter(
      (line) =>
        line.bbox &&
        line.bbox.x0 >= card.x0 + (card.x1 - card.x0) * 0.55 &&
        scoreDigitsFrom(line.text) != null &&
        Math.abs((line.bbox.y0 + line.bbox.y1) / 2 - midY) <= h * 0.55,
    );
    const scoreX0 =
      scoreLines.length > 0
        ? Math.min(...scoreLines.map((line) => line.bbox!.x0)) - 8
        : (defaultPointsX ?? card.x1 - (card.x1 - card.x0) * 0.26) - 8;

    const upperLines = inCard.filter(
      (line) =>
        line.bbox &&
        line.bbox.y1 <= card.y0 + h * 0.62 &&
        /[\p{L}\p{N}]/u.test(line.text),
    );
    const nameLines = upperLines.filter(
      (line) =>
        line.bbox &&
        /[\p{L}]/u.test(line.text) &&
        line.bbox.x0 < scoreX0 - 10 &&
        !ALLIANCE_TAG_PATTERN.test(line.text),
    );
    const nameX0 =
      nameLines.length > 0
        ? Math.min(...nameLines.map((line) => line.bbox!.x0)) - 4
        : (defaultNameX ?? card.x0 + (card.x1 - card.x0) * 0.2) - 4;
    const nameY0 =
      nameLines.length > 0
        ? Math.min(...nameLines.map((line) => line.bbox!.y0)) - 4
        : card.y0 + h * 0.08;
    const nameY1 = Math.min(
      card.y0 + h * 0.62,
      (nameLines.length > 0
        ? Math.max(...nameLines.map((line) => line.bbox!.y1))
        : card.y0 + h * 0.5) + 4,
    );

    const [rankOcr, nameOcr, tagOcr, pointsOcr] = await Promise.all([
      ocrRegionText(
        ctx.png,
        {
          left: card.x0 + 2,
          top: card.y0 + h * 0.12,
          width: Math.max(8, nameX0 - card.x0 - 4),
          height: h * 0.76,
        },
        { whitelist: DIGITS_WHITELIST },
      ),
      ocrRegionText(ctx.png, {
        left: nameX0,
        top: nameY0,
        width: Math.max(8, scoreX0 - nameX0 - 2),
        height: Math.max(8, nameY1 - nameY0),
      }),
      ocrRegionText(ctx.png, {
        left: nameX0,
        top: card.y0 + h * 0.55,
        width: Math.max(8, scoreX0 - nameX0 - 2),
        height: card.y1 - (card.y0 + h * 0.55) - 2,
      }),
      ocrRegionText(
        ctx.png,
        {
          left: scoreX0,
          top: card.y0 + h * 0.15,
          width: Math.max(8, card.x1 - scoreX0 - 2),
          height: h * 0.7,
        },
        { whitelist: DIGITS_GROUPED_WHITELIST },
      ),
    ]);

    const name = dropNonWordTokens(
      stripGlyphPrefixTokens(
        nameOcr.text
          // A `[` inside the name strip is the alliance-tag line bleeding
          // up — the tag (and everything after it) is not the member name.
          .replace(/\[.*$/u, " ")
          .replace(/\s+/g, " ")
          .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
          .trim(),
      ),
    ).trim();
    const tag = tagOcr.text.match(ALLIANCE_TAG_PATTERN)?.[1] ?? null;
    const scoreText = pointsOcr.text.trim().replace(/[.,\s](?=\d{3}\b)/g, "");
    const score = /^\d+$/.test(scoreText) ? scoreText : null;
    const rankDigits = digitsOnly(rankOcr.text);
    const rank =
      rankDigits != null &&
      Number.isSafeInteger(Number(rankDigits)) &&
      Number(rankDigits) >= 1 &&
      Number(rankDigits) <= 9999
        ? Number(rankDigits)
        : null;

    if (!isPlausibleMemberName(name) && score == null && rank == null) {
      continue;
    }

    const centerY = (card.y0 + card.y1) / 2;
    const pinned =
      ownTag != null && tag != null && tag.toUpperCase() === ownTag
        ? centerY > height * 0.8
        : false;
    entries.push({
      // Implausible names stay as "?" so dedup can still merge the row onto
      // its score's member instead of emitting a junk row.
      name: isPlausibleMemberName(name) ? name : "?",
      allianceTag: tag,
      actualScore: score,
      observedRank: rank,
      crop: toCrop({ x0: card.x0, y0: card.y0, x1: card.x1, y1: card.y1 }, width, height),
      ...(pinned ? { pinned: true } : {}),
    });
  }

  // Foreign-tag rows are NOT dropped here — a single frame cannot tell
  // whether the tag or the stored own tag is wrong. dedupeWarzoneEvidence
  // sees every frame and filters once it knows the own tag was observed.
  flagNonMonotonicLeaderboard(entries);
  return entries;
}

const POLL_HEADER_NAME_NOISE =
  /\b(?:chose\s+option|voting\s+members?|the\s+following)\b/iu;

/**
 * Poll rows anchored on the `Power:` / `LV.` line: each card's name sits
 * directly above its Power line in the same text column. Re-OCRing just
 * that strip (x starting at the Power label — right of the avatar/badge
 * icons — so glyph fragments never enter the name) with a single-line psm
 * is far cleaner than trusting the full-page psm-11 line text.
 */
async function parsePollAnchored(
  ctx: CardOcrContext,
  lines: readonly Line[],
  opts?: { scanWholeFrame?: boolean },
): Promise<WarzonePollEntry[]> {
  const { width, height } = ctx;
  const voting = lines.find(
    (line) => HEADER_VOTING.test(line.text) && line.bbox,
  );
  if (!voting?.bbox && !opts?.scanWholeFrame) return [];
  const dialogTop = voting?.bbox?.y0 ?? 0;
  const headerHeight = voting?.bbox
    ? Math.max(1, voting.bbox.y1 - voting.bbox.y0)
    : 0;

  const entries: WarzonePollEntry[] = [];
  for (const line of lines) {
    if (!line.bbox || line.bbox.y0 <= dialogTop) continue;
    const power = line.text.match(POWER_PATTERN);
    if (!power) continue;
    if (line.bbox.y0 - dialogTop < headerHeight * 0.5) continue;
    const powerHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
    const powerBox = line.bbox;

    // The member name sits on the line directly above the Power/LV row.
    const nameLine = lines
      .filter(
        (other) =>
          other !== line &&
          other.bbox &&
          other.bbox.y1 <= powerBox.y1 &&
          other.bbox.y1 >= powerBox.y0 - powerHeight * 2.5 &&
          /[\p{L}]/u.test(other.text) &&
          !POWER_PATTERN.test(other.text) &&
          !LEVEL_PATTERN.test(other.text) &&
          !HEADER_VOTING.test(other.text) &&
          Math.abs(other.bbox.x0 - powerBox.x0) <= width * 0.15,
      )
      .sort(
        // Badge glyphs (`R3`) hug the Power column closer than the real
        // name — rank candidates by letter content first, x-proximity after.
        (a, b) =>
          b.text.replace(/[^\p{L}]/gu, "").length -
            a.text.replace(/[^\p{L}]/gu, "").length ||
          Math.abs(a.bbox!.x0 - powerBox.x0) - Math.abs(b.bbox!.x0 - powerBox.x0) ||
          b.bbox!.y1 - a.bbox!.y1,
      )[0];

    // Name strip: name line's y-range (or the band directly above Power),
    // x from the Power label — right of the badge icons — to the name end.
    const nameY0 = nameLine?.bbox
      ? nameLine.bbox.y0 - 3
      : powerBox.y0 - powerHeight * 2.3;
    const nameY1 = nameLine?.bbox
      ? nameLine.bbox.y1 + 3
      : powerBox.y0 - powerHeight * 0.1;
    const nameX0 = powerBox.x0 - 4;
    const nameX1 = Math.max(nameLine?.bbox?.x1 ?? 0, powerBox.x1) + 6;
    const region =
      nameY1 - nameY0 >= 6 && nameX1 - nameX0 >= 8
        ? await ocrRegionText(ctx.png, {
            left: nameX0,
            top: nameY0,
            width: nameX1 - nameX0,
            height: nameY1 - nameY0,
          })
        : { text: "", confidence: 0 };

    const candidates = [region.text, nameLine?.text ?? ""];
    for (const candidate of candidates) {
      const cleaned = dropNonWordTokens(
        stripGlyphPrefixTokens(
          candidate
            .replace(/\s+/g, " ")
            .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
        ),
      ).trim();
      if (POLL_HEADER_NAME_NOISE.test(cleaned)) continue;
      if (cleaned.length < 4 || letterRatio(cleaned) < 0.6) continue;
      if (region.text === candidate && region.confidence < 20) continue;
      entries.push({
        name: cleaned,
        crop: toCrop(
          {
            x0: Math.min(nameLine?.bbox?.x0 ?? powerBox.x0, powerBox.x0),
            y0: nameY0,
            x1: Math.max(nameLine?.bbox?.x1 ?? powerBox.x1, powerBox.x1),
            y1: powerBox.y1,
          },
          width,
          height,
        ),
      });
      break;
    }
  }
  // One row per member per frame — anchors can double-fire.
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = fuzzyWarzoneNameKey(entry.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * OCR one frame buffer (Sharp normalize → Tesseract) into the typed frame
 * contract. Exported for the image-ingest path and real-frame verification.
 */
export async function ocrWarzoneNativeImage(
  buffer: Buffer,
  options?: { ownAllianceTag?: string | null; format?: WarzoneUploadFormat },
): Promise<{ frame: WarzoneFrame; safeCrop: WarzoneCropRegion | null; formatMismatch: boolean }> {
  const normalized = sharp(buffer).rotate().resize({
    width: WARZONE_CANONICAL_WIDTH,
  });
  const [{ data: image, info }, rawResult] = await Promise.all([
    normalized.clone().png().toBuffer({ resolveWithObject: true }),
    normalized.clone().raw().toBuffer({ resolveWithObject: true }),
  ]);
  const lines = await runTesseract(image, {
    tesseractPsm: 11,
    minWordConfidence: 0,
  });

  const detected = detectWarzoneLayout(lines);
  const format = options?.format ?? "auto";
  const formatMismatch =
    format !== "auto" && detected !== "unknown" && detected !== format;

  const ctx: CardOcrContext = {
    png: image,
    raw: rawResult.data,
    channels: rawResult.info.channels,
    width: info.width,
    height: info.height,
  };

  if (detected === "poll") {
    const option = detectPollOption(lines);
    let entries = await parsePollAnchored(ctx, lines);
    let safeCrop: WarzoneCropRegion | null = null;
    const fallback = parseWarzonePollLines(lines, info.width, info.height);
    if (entries.length === 0) {
      entries = fallback.entries;
      const voting = lines.find((line) => HEADER_VOTING.test(line.text));
      const headerBoxes = [
        voting?.bbox ?? null,
        ...fallback.entries
          .map((entry) => entry.crop)
          .filter((crop): crop is WarzoneCropRegion => crop != null)
          .map((crop) => ({
            x0: crop.left * info.width,
            y0: crop.top * info.height,
            x1: (crop.left + crop.width) * info.width,
            y1: (crop.top + crop.height) * info.height,
          })),
      ].filter((box): box is Bbox => box != null);
      safeCrop = unionCrop(headerBoxes, info.width, info.height);
    } else {
      // Keep rows the band pass missed — card-contiguous dialogs can
      // merge visually, so line anchors remain the safety net.
      const known = new Set(entries.map((e) => fuzzyWarzoneNameKey(e.name)));
      for (const row of fallback.entries) {
        if (!known.has(fuzzyWarzoneNameKey(row.name))) entries.push(row);
      }
      const boxes = entries
        .map((entry) => entry.crop)
        .filter((crop): crop is WarzoneCropRegion => crop != null)
        .map((crop) => ({
          x0: crop.left * info.width,
          y0: crop.top * info.height,
          x1: (crop.left + crop.width) * info.width,
          y1: (crop.top + crop.height) * info.height,
        }));
      const voting = votingBox(lines);
      if (voting) boxes.unshift(voting);
      safeCrop = unionCrop(boxes, info.width, info.height);
    }
    return {
      frame: { kind: "poll", option, entries },
      safeCrop,
      formatMismatch,
    };
  }

  if (detected === "leaderboard") {
    let entries = await parseLeaderboardFromCards(
      ctx,
      lines,
      options?.ownAllianceTag,
    );
    const fallback = parseWarzoneLeaderboardLines(
      lines,
      info.width,
      info.height,
      options?.ownAllianceTag,
    );
    if (entries.length === 0) {
      entries = fallback;
    } else {
      // Rows on cards the band pass clipped/missed still count — merge
      // line-parsed rows whose member or score is not already covered.
      const knownNames = new Set(entries.map((e) => fuzzyWarzoneNameKey(e.name)));
      const knownScores = new Set(
        entries.map((e) => e.actualScore).filter((s): s is string => s != null),
      );
      for (const row of fallback) {
        if (knownNames.has(fuzzyWarzoneNameKey(row.name))) continue;
        if (row.actualScore != null && knownScores.has(row.actualScore)) {
          continue;
        }
        entries.push(row);
      }
    }
    flagNonMonotonicLeaderboard(entries);
    entries.sort(
      (a, b) => (a.crop?.top ?? 0) - (b.crop?.top ?? 0),
    );
    if (entries.length === 0) {
      return {
        frame: { kind: "unknown", reason: "leaderboard_no_rows" },
        safeCrop: null,
        formatMismatch,
      };
    }
    const headerBoxes = lines
      .filter(
        (line) =>
          line.bbox &&
          (HEADER_LEADERBOARD.test(line.text) ||
            HEADER_COMMANDER.test(line.text) ||
            HEADER_POINTS.test(line.text)),
      )
      .map((line) => line.bbox!);
    const rowBoxes = entries
      .map((entry) => entry.crop)
      .filter((crop): crop is WarzoneCropRegion => crop != null)
      .map((crop) => ({
        x0: crop.left * info.width,
        y0: crop.top * info.height,
        x1: (crop.left + crop.width) * info.width,
        y1: (crop.top + crop.height) * info.height,
      }));
    return {
      frame: { kind: "leaderboard", entries },
      safeCrop: unionCrop([...headerBoxes, ...rowBoxes], info.width, info.height),
      formatMismatch,
    };
  }

  // Header unreadable (mid-scroll frames, motion blur): still try both
  // parsers — ≥2 structured rows prove the layout. A poll frame parsed
  // this way carries `option: null`, so its rows stay unresolved and are
  // never silently bucketed as Yes/No.
  if (format === "auto" || format === "leaderboard") {
    const cardEntries = await parseLeaderboardFromCards(
      ctx,
      [],
      options?.ownAllianceTag,
      { scanWholeFrame: true },
    );
    const entries =
      cardEntries.length >= 2
        ? cardEntries
        : parseWarzoneLeaderboardLines(
            lines,
            info.width,
            info.height,
            options?.ownAllianceTag,
          );
    if (entries.length >= 2) {
      flagNonMonotonicLeaderboard(entries);
      return {
        frame: { kind: "leaderboard", entries },
        safeCrop: unionCrop(
          entries
            .map((e) => e.crop)
            .filter((c): c is WarzoneCropRegion => c != null)
            .map((crop) => ({
              x0: crop.left * info.width,
              y0: crop.top * info.height,
              x1: (crop.left + crop.width) * info.width,
              y1: (crop.top + crop.height) * info.height,
            })),
          info.width,
          info.height,
        ),
        formatMismatch,
      };
    }
  }
  if (format === "auto" || format === "poll") {
    const cardEntries = await parsePollAnchored(ctx, [], {
      scanWholeFrame: true,
    });
    const entries =
      cardEntries.length >= 2
        ? cardEntries
        : parseWarzonePollLines(lines, info.width, info.height).entries;
    if (entries.length >= 2) {
      return {
        frame: { kind: "poll", option: detectPollOption(lines), entries },
        safeCrop: unionCrop(
          entries
            .map((e) => e.crop)
            .filter((c): c is WarzoneCropRegion => c != null)
            .map((crop) => ({
              x0: crop.left * info.width,
              y0: crop.top * info.height,
              x1: (crop.left + crop.width) * info.width,
              y1: (crop.top + crop.height) * info.height,
            })),
          info.width,
          info.height,
        ),
        formatMismatch,
      };
    }
  }

  return {
    frame: { kind: "unknown", reason: "layout_not_detected" },
    safeCrop: null,
    formatMismatch,
  };
}

function votingBox(lines: readonly Line[]): Bbox | null {
  return (
    lines.find((line) => HEADER_VOTING.test(line.text))?.bbox ?? null
  );
}

/** Frame-level OCR over a job's extracted frames (video or image ingest). */
export async function ocrWarzoneNativeFrames(
  frames: Array<{
    index: number;
    buffer: Buffer;
    videoTimestampSeconds?: number | null;
  }>,
  options: {
    targetId: WarzoneEvidenceTargetId;
    ownAllianceTag?: string | null;
    onProgress?: VideoOcrProgressCallback;
  },
): Promise<OcrAllFramesResult & { warzoneFrames: WarzoneFrameResult[] }> {
  const format = warzoneTargetFormat(options.targetId);
  const warzoneFrames: WarzoneFrameResult[] = [];
  const entries: OcrEntry[] = [];
  const frameTimings: OcrAllFramesResult["frameTimings"] = [];

  try {
  for (const [offset, frame] of frames.entries()) {
    const started = Date.now();
    const parsed = await ocrWarzoneNativeImage(frame.buffer, {
      ownAllianceTag: options.ownAllianceTag,
      format,
    });
    warzoneFrames.push({
      frameIndex: frame.index,
      videoTimestampSeconds: frame.videoTimestampSeconds ?? null,
      frame: parsed.frame,
      safeCrop: parsed.safeCrop,
      formatMismatch: parsed.formatMismatch,
    });
    // Flattened OcrEntry rows keep the shared counts/progress plumbing
    // working; the authoritative per-row contract lives in warzoneFrames.
    const flat: OcrEntry[] =
      parsed.frame.kind === "leaderboard"
        ? parsed.frame.entries.map((entry) => ({
            name: entry.name,
            score: entry.actualScore ?? "",
            rank: entry.observedRank ?? undefined,
            _sourceFrameIndex: frame.index,
          }))
        : parsed.frame.kind === "poll"
          ? parsed.frame.entries.map((entry) => ({
              name: entry.name,
              score: "",
              _sourceFrameIndex: frame.index,
            }))
          : [];
    entries.push(...flat);
    const ms = Date.now() - started;
    frameTimings.push({
      frameIndex: frame.index,
      ms,
      uploadMs: 0,
      extractMs: ms,
      entryCount: flat.length,
      error: null,
      rawResult: {
        warzone: parsed.frame,
        safeCrop: parsed.safeCrop,
        formatMismatch: parsed.formatMismatch,
      },
    });
    await options.onProgress?.(offset + 1, frames.length);
  }
  } finally {
    // The shared tesseract worker is a long-lived child process — release it
    // when the batch finishes so CLI/batch callers don't hang on exit.
    await terminateTesseractWorker().catch(() => undefined);
  }
  return { entries, observations: entries, frameTimings, concurrency: 1, warzoneFrames };
}
