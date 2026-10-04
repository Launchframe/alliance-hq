import { OcrLearningError } from "./types.shared";

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined || typeof value === "number" && !Number.isFinite(value)) throw new OcrLearningError("invalid_json");
    return result;
  }
  if (Array.isArray(value)) return `[${Array.from(value, stableJson).join(",")}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new OcrLearningError("invalid_json");
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
