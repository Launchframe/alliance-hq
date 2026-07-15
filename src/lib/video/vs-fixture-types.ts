/** Shared types for the dev VS score fixture library. */

export type VsScoreFixtureRow = {
  name: string;
  score: number;
  rank?: number;
  /** Optional Ashed id from scrape; rematch still runs by name. */
  memberId?: string;
};

export type VsScoreDayTemplate = {
  id: string;
  name: string;
  tags: string[];
  kind: "day";
  sourceRecordedDate: string;
  scrapedAt: string;
  allianceTag?: string;
  rows: VsScoreFixtureRow[];
};

export type VsScoreWeekTemplate = {
  id: string;
  name: string;
  tags: string[];
  kind: "week";
  sourceWeekStart: string;
  scrapedAt: string;
  allianceTag?: string;
  days: Array<{
    sourceRecordedDate: string;
    rows: VsScoreFixtureRow[];
  }>;
};

export type VsScoreTemplate = VsScoreDayTemplate | VsScoreWeekTemplate;
