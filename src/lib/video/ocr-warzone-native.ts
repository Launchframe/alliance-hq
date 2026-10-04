import "server-only";

import sharp from "sharp";

import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
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
    // Leading avatar/badge fragments ("[I 8 @", "5", "12% &", "i &") are
    // never part of the name — drop leading tokens that carry no letter or
    // are a lone lowercase letter, then keep the remaining name-like run.
    const tokens = scrubbed.split(" ");
    while (
      tokens.length > 1 &&
      (!/[\p{L}]/u.test(tokens[0]!) || /^[\p{Ll}]$/u.test(tokens[0]!))
    ) {
      tokens.shift();
    }
    return tokens.join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
  };

  for (const line of lines) {
    if (!line.bbox || line.bbox.y0 <= dialogTop) continue;
    const power = line.text.match(POWER_PATTERN);
    if (!power) continue;
    if (line.bbox.y0 - dialogTop < headerHeight * 0.5) continue;
    const powerHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);

    const beforePower = cleanName(line.text.slice(0, power.index ?? 0));
    if (/[\p{L}]/u.test(beforePower)) {
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
    if (!/[\p{L}]/u.test(name)) continue;
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
    const text = line.text.trim();
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
    // A row with no score, rank, or alliance tag is stray UI text, not a
    // leaderboard entry.
    if (rank == null && score == null && tag == null) continue;
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

  // Foreign-tag filtering: a row carrying a different alliance tag is not
  // our member — drop it. Tag-less rows stay (reviewer decides).
  const own = candidates.filter(
    (row) => row.tag == null || ownTag == null || row.tag.toUpperCase() === ownTag,
  );

  // Pinned self-row dedup: the same (name, score) tuple appearing twice —
  // the lower copy is the pinned duplicate.
  const seen = new Set<string>();
  const entries: WarzoneLeaderboardEntry[] = [];
  for (const row of own) {
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

/**
 * OCR one frame buffer (Sharp normalize → Tesseract) into the typed frame
 * contract. Exported for the image-ingest path and real-frame verification.
 */
export async function ocrWarzoneNativeImage(
  buffer: Buffer,
  options?: { ownAllianceTag?: string | null; format?: WarzoneUploadFormat },
): Promise<{ frame: WarzoneFrame; safeCrop: WarzoneCropRegion | null; formatMismatch: boolean }> {
  const { data: image, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 1800, withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const lines = await runTesseract(image, {
    tesseractPsm: 11,
    minWordConfidence: 0,
  });
  return parseWarzoneFrameLines(lines, info.width, info.height, options);
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
  return { entries, observations: entries, frameTimings, concurrency: 1, warzoneFrames };
}
