/** Canonical Ashed Member entity shape (Base44 list response). */

export type AshedMemberProfession = "Engineer" | "War Leader";

export type AshedMemberHistoryPoint<T> = {
  value: T;
  recorded_date: string;
};

export type AshedMemberRecord = {
  id?: string;
  alliance_id?: string;
  current_name: string;
  previous_names?: string[];
  status?: string;
  rank?: string | number | null;
  profession?: AshedMemberProfession | string | null;
  level?: number | null;
  join_date?: string | null;
  timezone?: string | null;
  notes?: string | null;
  power_level?: string | null;
  current_kills?: number | null;
  professional_level?: number | null;
  current_total_hero_power?: number | null;
  recorded_date?: string | null;
  current_squad_power?: unknown[];
  squad_power_snapshots?: unknown[];
  professional_level_history?: AshedMemberHistoryPoint<number>[];
  level_history?: AshedMemberHistoryPoint<number>[];
  power_level_history?: AshedMemberHistoryPoint<string>[];
  total_hero_power_history?: AshedMemberHistoryPoint<number>[];
  created_date?: string | null;
  updated_date?: string | null;
  created_by_id?: string | null;
  created_by?: string | null;
  is_sample?: boolean;
};

/** Subset extracted from roster scroll video via Ashed vision OCR. */
export type RosterVideoOcrMember = {
  current_name: string;
  rank?: string;
  power_level?: string;
  level?: number;
  profession?: string;
  status?: string;
};

export const MEMBER_ROSTER_VIDEO_SCORE_TARGET = "member-roster-video" as const;

export const ROSTER_VIDEO_OCR_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    members: {
      type: "array",
      items: {
        type: "object",
        properties: {
          current_name: { type: "string" },
          rank: { type: "string" },
          power_level: { type: "string" },
          level: { type: "number" },
          profession: { type: "string" },
          status: { type: "string" },
        },
        required: ["current_name"],
      },
    },
  },
  required: ["members"],
};
