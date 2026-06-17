/**
 * OCR parsing types for alliance member roster screenshots.
 *
 * Supports two layouts observed in Last War:
 *  - 'officers'    : Titled officers screen (R5 center card, R4 titled rows)
 *  - 'rank_list'   : Collapsible rank-list screen (R1-R5 headers with member rows)
 */

export type RosterLayout = "officers" | "rank_list";

export type AllianceRank = 1 | 2 | 3 | 4 | 5;

/** A single parsed row from a roster screenshot. */
export type ParsedRosterRow = {
  /** Raw extracted name string from OCR. */
  extractedName: string;
  /** Alliance rank (R1–R5). */
  allianceRank: AllianceRank;
  /** Titled role for R4+ members (Warlord, Recruiter, Muse, Butler, Leader, etc.) */
  allianceRankTitle?: string;
  /** Hero power in millions, e.g. 4.2 for "4.2M". */
  heroPowerM?: number;
  /** Member level, e.g. 85 for "Lv.85". */
  memberLevel?: number;
  /** Which layout this row was detected in. */
  layout: RosterLayout;
};

/** Full result returned by the orchestrator. */
export type ParseRosterImageResult = {
  rows: ParsedRosterRow[];
  layout: RosterLayout;
  /** The parse config pass key that was active (if any). */
  configPassKey?: string;
  diagnostics?: {
    rawLineCount: number;
    ignoredLineCount: number;
    durationMs: number;
  };
};

/** Config shape for roster OCR experiments (stored in parse_configs.config_json). */
export type RosterOcrConfig = {
  /** Mode discriminant so validation can distinguish from video ExtractionConfig. */
  mode: "roster-ocr";
  /** Sharp resize scale factor applied before OCR (default 2.0). */
  preprocessScale?: number;
  /** Tesseract page segmentation mode (default 6 = single uniform block). */
  tesseractPsm?: number;
  /** If set, tesseract whitelist applied via tessedit_char_whitelist. */
  charWhitelist?: string;
  /** Min confidence threshold (0–100) to accept an OCR word (default 40). */
  minWordConfidence?: number;
};

export const DEFAULT_ROSTER_OCR_CONFIG: RosterOcrConfig = {
  mode: "roster-ocr",
  preprocessScale: 2.0,
  tesseractPsm: 6,
  minWordConfidence: 40,
};

/** Score target identifier used throughout the experiment + parse-config platform. */
export const ROSTER_OCR_SCORE_TARGET = "member-roster-screenshot" as const;
