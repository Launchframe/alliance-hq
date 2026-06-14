import crypto from "node:crypto";

const CAPTURE_SESSION_TTL_MS = 15 * 60 * 1000;
const DEV_CAPTURE_SESSION_FALLBACK = "dev-bug-report-capture-secret";

export function captureSessionSecret(): string {
  const configured =
    process.env.BUG_REPORT_CAPTURE_SECRET ||
    process.env.TOKEN_ENCRYPTION_KEY;

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "development") {
    return DEV_CAPTURE_SESSION_FALLBACK;
  }

  throw new Error(
    "BUG_REPORT_CAPTURE_SECRET or TOKEN_ENCRYPTION_KEY is required for bug report capture sessions",
  );
}

export type CaptureSessionPayload = {
  sessionId: string;
  userId: string;
  expiresAt: number;
};

export function createBugReportCaptureSession(userId: string): CaptureSessionPayload & {
  token: string;
} {
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + CAPTURE_SESSION_TTL_MS;
  const token = signCaptureSession({ sessionId, userId, expiresAt });

  return { sessionId, userId, expiresAt, token };
}

export function signCaptureSession(payload: CaptureSessionPayload): string {
  const message = `${payload.sessionId}:${payload.userId}:${payload.expiresAt}`;
  return crypto
    .createHmac("sha256", captureSessionSecret())
    .update(message)
    .digest("hex");
}

export function verifyBugReportCaptureSession({
  sessionId,
  userId,
  expiresAt,
  token,
}: CaptureSessionPayload & { token: string }): boolean {
  if (!sessionId || !userId || !token || !expiresAt) {
    return false;
  }

  if (Date.now() > expiresAt) {
    return false;
  }

  const expected = signCaptureSession({ sessionId, userId, expiresAt });
  const expectedBuffer = Buffer.from(expected, "hex");
  const tokenBuffer = Buffer.from(token, "hex");

  if (expectedBuffer.length !== tokenBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, tokenBuffer);
}
