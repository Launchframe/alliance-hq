export const SURVEY_SCROLL_STYLES = [
  "slow_steady",
  "fast",
  "page_by_page",
  "chaotic",
] as const;

export type SurveyScrollStyle = (typeof SURVEY_SCROLL_STYLES)[number];

export type SurveyPayload = {
  rowCountEstimate: number | null;
  scrollStyle: SurveyScrollStyle | null;
  aboveAverageScroll: boolean | null;
};

type SurveyBody = {
  rowCountEstimate?: number | null;
  scrollStyle?: string | null;
  aboveAverageScroll?: boolean | null;
};

function parseRowCountEstimate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 9999) return null;
  return rounded;
}

function parseScrollStyle(value: unknown): SurveyScrollStyle | null {
  if (typeof value !== "string") return null;
  return (SURVEY_SCROLL_STYLES as readonly string[]).includes(value)
    ? (value as SurveyScrollStyle)
    : null;
}

function parseAboveAverageScroll(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseSurveyBody(body: SurveyBody): SurveyPayload {
  return {
    rowCountEstimate: parseRowCountEstimate(body.rowCountEstimate),
    scrollStyle: parseScrollStyle(body.scrollStyle),
    aboveAverageScroll: parseAboveAverageScroll(body.aboveAverageScroll),
  };
}

export function hasSurveyAnswers(payload: SurveyPayload): boolean {
  return (
    payload.rowCountEstimate !== null ||
    payload.scrollStyle !== null ||
    payload.aboveAverageScroll !== null
  );
}
