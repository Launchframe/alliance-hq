import { encode } from "@auth/core/jwt";

export const NEXT_AUTH_SESSION_COOKIE = "authjs.session-token";

export function e2eAuthSecret(): string {
  return (
    process.env.AUTH_SECRET?.trim() ||
    "e2e-test-auth-secret-min-32-characters"
  );
}

export async function encodeNextAuthSessionToken(input: {
  hqUserId: string;
  email: string;
  name?: string;
}): Promise<string> {
  return encode({
    token: {
      sub: input.hqUserId,
      email: input.email.toLowerCase(),
      name: input.name ?? input.email,
    },
    secret: e2eAuthSecret(),
    maxAge: 90 * 24 * 60 * 60,
    salt: NEXT_AUTH_SESSION_COOKIE,
  });
}

export function nextAuthSessionCookie(token: string) {
  return {
    name: NEXT_AUTH_SESSION_COOKIE,
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax" as const,
  };
}

export function playwrightAuthCookies(input: {
  sessionId: string;
  nextAuthToken: string;
}) {
  return [
    {
      name: "alliance_hq_session",
      value: input.sessionId,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax" as const,
    },
    nextAuthSessionCookie(input.nextAuthToken),
  ];
}

export function authCookieHeader(input: {
  sessionId: string;
  nextAuthToken: string;
}): string {
  return `alliance_hq_session=${input.sessionId}; ${NEXT_AUTH_SESSION_COOKIE}=${input.nextAuthToken}`;
}
