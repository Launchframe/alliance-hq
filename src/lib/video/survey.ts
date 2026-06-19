export const SURVEY_SCROLL_STYLES = [
  "slow_steady",
  "fast",
  "page_by_page",
  "chaotic",
] as const;

export type SurveyScrollStyle = (typeof SURVEY_SCROLL_STYLES)[number];

export const SURVEY_SCHOOLING_ANSWERS = ["yes", "no", "idk"] as const;

export type SurveySchoolingAnswer = (typeof SURVEY_SCHOOLING_ANSWERS)[number];

export type SurveyPayload = {
  rowCountEstimate: number | null;
  scrollStyle: SurveyScrollStyle | null;
  aboveAverageScroll: boolean | null;
  schoolingTuitionAnswer: SurveySchoolingAnswer | null;
};

type SurveyBody = {
  rowCountEstimate?: number | null;
  scrollStyle?: string | null;
  aboveAverageScroll?: boolean | null;
  schoolingTuitionAnswer?: string | null;
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

function parseSchoolingTuitionAnswer(value: unknown): SurveySchoolingAnswer | null {
  if (typeof value !== "string") return null;
  return (SURVEY_SCHOOLING_ANSWERS as readonly string[]).includes(value)
    ? (value as SurveySchoolingAnswer)
    : null;
}

export function schoolingAnswerToAboveAverage(
  answer: SurveySchoolingAnswer,
): boolean | null {
  if (answer === "yes") return true;
  if (answer === "no") return false;
  return null;
}

export function parseSurveyBody(body: SurveyBody): SurveyPayload {
  const schoolingTuitionAnswer = parseSchoolingTuitionAnswer(
    body.schoolingTuitionAnswer,
  );
  const aboveFromSchooling =
    schoolingTuitionAnswer != null
      ? schoolingAnswerToAboveAverage(schoolingTuitionAnswer)
      : null;

  return {
    rowCountEstimate: parseRowCountEstimate(body.rowCountEstimate),
    scrollStyle: parseScrollStyle(body.scrollStyle),
    schoolingTuitionAnswer,
    aboveAverageScroll:
      aboveFromSchooling ?? parseAboveAverageScroll(body.aboveAverageScroll),
  };
}

export function hasSurveyAnswers(payload: SurveyPayload): boolean {
  return (
    payload.rowCountEstimate !== null ||
    payload.scrollStyle !== null ||
    payload.aboveAverageScroll !== null ||
    payload.schoolingTuitionAnswer !== null
  );
}

export function isSurveyQ3Complete(payload: SurveyPayload): boolean {
  return (
    payload.schoolingTuitionAnswer !== null || payload.aboveAverageScroll !== null
  );
}

export function isSurveyComplete(payload: SurveyPayload | null): boolean {
  if (!payload) return false;
  return (
    payload.rowCountEstimate !== null &&
    payload.scrollStyle !== null &&
    isSurveyQ3Complete(payload)
  );
}

/** First step the user still needs to answer (1–3). */
export function surveyResumeStep(payload: SurveyPayload | null): number {
  if (!payload || payload.rowCountEstimate === null) return 1;
  if (payload.scrollStyle === null) return 2;
  if (!isSurveyQ3Complete(payload)) return 3;
  return 3;
}

export function surveyNeedsResume(payload: SurveyPayload | null): boolean {
  return !isSurveyComplete(payload);
}

export type SurveyAccumulated = {
  rowCountEstimate: number | null;
  scrollStyle: SurveyScrollStyle | null;
  schoolingTuitionAnswer: SurveySchoolingAnswer | null;
};

export function accumulatedFromPayload(
  payload: SurveyPayload,
): SurveyAccumulated {
  let schoolingTuitionAnswer = payload.schoolingTuitionAnswer;
  if (schoolingTuitionAnswer === null && payload.aboveAverageScroll === true) {
    schoolingTuitionAnswer = "yes";
  }
  if (schoolingTuitionAnswer === null && payload.aboveAverageScroll === false) {
    schoolingTuitionAnswer = "no";
  }
  return {
    rowCountEstimate: payload.rowCountEstimate,
    scrollStyle: payload.scrollStyle,
    schoolingTuitionAnswer,
  };
}

export function surveyRowToPayload(row: {
  rowCountEstimate: number | null;
  scrollStyle: string | null;
  aboveAverageScroll: boolean | null;
  schoolingTuitionAnswer: string | null;
}): SurveyPayload {
  return parseSurveyBody({
    rowCountEstimate: row.rowCountEstimate,
    scrollStyle: row.scrollStyle,
    aboveAverageScroll: row.aboveAverageScroll,
    schoolingTuitionAnswer: row.schoolingTuitionAnswer,
  });
}

/** Merge a partial client save with an existing survey row without nulling prior answers. */
export function mergeSurveyPayload(
  existing: SurveyPayload | null,
  incoming: SurveyPayload,
): SurveyPayload {
  return parseSurveyBody({
    rowCountEstimate:
      incoming.rowCountEstimate ?? existing?.rowCountEstimate ?? null,
    scrollStyle: incoming.scrollStyle ?? existing?.scrollStyle ?? null,
    schoolingTuitionAnswer:
      incoming.schoolingTuitionAnswer ?? existing?.schoolingTuitionAnswer ?? null,
    aboveAverageScroll:
      incoming.aboveAverageScroll ?? existing?.aboveAverageScroll ?? null,
  });
}
