export type CaptureReminderCoords = {
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
};

export function hasCompleteCaptureCoords(input: {
  gameServerNumber?: number | null;
  coordX?: number | null;
  coordY?: number | null;
  level?: number | null;
}): boolean {
  return (
    input.gameServerNumber != null &&
    input.coordX != null &&
    input.coordY != null &&
    input.level != null
  );
}

export function parseCaptureReminderCoordsBody(
  body: unknown,
): CaptureReminderCoords | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const gameServerNumber = parseCoordInt(record.gameServerNumber);
  const coordX = parseCoordInt(record.coordX);
  const coordY = parseCoordInt(record.coordY);
  const level = parseCoordInt(record.level);
  if (
    gameServerNumber == null ||
    coordX == null ||
    coordY == null ||
    level == null
  ) {
    return null;
  }
  return { gameServerNumber, coordX, coordY, level };
}

function parseCoordInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function validateCaptureReminderCoords(
  coords: CaptureReminderCoords,
): string | null {
  if (coords.gameServerNumber < 1 || coords.gameServerNumber > 9999) {
    return "Server number must be between 1 and 9999.";
  }
  if (coords.coordX < 0 || coords.coordX > 9999) {
    return "X coordinate must be between 0 and 9999.";
  }
  if (coords.coordY < 0 || coords.coordY > 9999) {
    return "Y coordinate must be between 0 and 9999.";
  }
  if (coords.level < 1 || coords.level > 99) {
    return "Level must be between 1 and 99.";
  }
  return null;
}
