export type StormTeam = "A" | "B";

export function isStormTeam(value: unknown): value is StormTeam {
  return value === "A" || value === "B";
}

/** True when any Ashed score row matches the selected team (and date when present). */
export function ashedStormScoresOverlapTeam(params: {
  rows: Array<{ team?: string | null; recorded_date?: string | null }>;
  team: StormTeam;
  recordedDate: string;
}): boolean {
  return params.rows.some((row) => {
    if (row.team !== params.team) return false;
    if (!row.recorded_date) return true;
    return row.recorded_date === params.recordedDate;
  });
}
