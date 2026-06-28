import "server-only";

import { encode } from "@auth/core/jwt";

const NEXT_AUTH_SESSION_TOKEN = "authjs.session-token";
const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/**
 * Cookie name NextAuth reads for the JWT session. Secure transports use the
 * `__Secure-` prefix (Vercel preview/prod over https); plain http (local dev)
 * uses the bare name. Pass the request's effective protocol.
 */
export function nextAuthSessionCookieName(secure: boolean): string {
  return secure ? `__Secure-${NEXT_AUTH_SESSION_TOKEN}` : NEXT_AUTH_SESSION_TOKEN;
}

function devAuthSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET is not set");
  }
  return secret;
}

/**
 * Mints an Auth.js-compatible JWT session token for the given HQ user. Mirrors
 * the production `jwt` callback shape (`sub`, `email`, `name`) so the bridged
 * browser session resolves to this user. Dev/preview quick-switch only.
 */
export async function mintNextAuthSessionToken(input: {
  hqUserId: string;
  email: string;
  name?: string | null;
}): Promise<string> {
  return encode({
    token: {
      sub: input.hqUserId,
      email: input.email.toLowerCase(),
      name: input.name ?? input.email,
    },
    secret: devAuthSecret(),
    maxAge: SESSION_MAX_AGE_SECONDS,
    salt: NEXT_AUTH_SESSION_TOKEN,
  });
}
