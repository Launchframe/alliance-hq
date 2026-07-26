import { timingSafeEqual } from "crypto";

function bearerMatches(secret: string, authHeader: string | null): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(authHeader ?? "", "utf8");
  if (expected.length !== received.length) return false;
  try {
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export type AuthorizeCronOptions = {
  /** Additional env var names accepted as Bearer secrets (e.g. VIDEO_WORKER_SECRET). */
  alternateEnvKeys?: string[];
};

/** Timing-safe Bearer auth for internal Vercel cron / worker routes. */
export function authorizeCron(
  request: Request,
  options?: AuthorizeCronOptions,
): boolean {
  const auth = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && bearerMatches(cronSecret, auth)) {
    return true;
  }
  for (const key of options?.alternateEnvKeys ?? []) {
    const secret = process.env[key]?.trim();
    if (secret && bearerMatches(secret, auth)) {
      return true;
    }
  }
  return false;
}
