import "server-only";

import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { createHqAuthAdapter } from "@/lib/auth/adapter";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";

const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createHqAuthAdapter(),
  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: "/auth",
    verifyRequest: "/auth/check-email",
    error: "/auth/error",
  },
  providers: [
    Resend({
      from: process.env.EMAIL_FROM ?? "Alliance HQ <onboarding@resend.dev>",
      apiKey: process.env.RESEND_API_KEY,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Magic-link send also invokes signIn before hq_users exists; do not bridge here.
      // #region agent log
      fetch("http://127.0.0.1:7685/ingest/a19db502-b55d-438f-8e5d-f1296113f8f3", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Debug-Session-Id": "f76120",
        },
        body: JSON.stringify({
          sessionId: "f76120",
          runId: "post-fix",
          hypothesisId: "E",
          location: "auth/index.ts:signIn",
          message: "signIn callback (no bridge)",
          data: {
            hasEmail: Boolean(user.email),
            userIdLength: user.id?.length ?? 0,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return Boolean(user.email);
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const hqUserId = await ensureHqUserForAuthEmail(user.email, user.name);
        token.sub = hqUserId;
        token.email = user.email;
        token.name = user.name;

        // #region agent log
        fetch("http://127.0.0.1:7685/ingest/a19db502-b55d-438f-8e5d-f1296113f8f3", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": "f76120",
          },
          body: JSON.stringify({
            sessionId: "f76120",
            runId: "post-fix",
            hypothesisId: "C",
            location: "auth/index.ts:jwt",
            message: "jwt mapped auth user to hq_user",
            data: {
              authUserIdLength: user.id?.length ?? 0,
              hqUserIdLength: hqUserId.length,
              idsMatch: user.id === hqUserId,
            },
            timestamp: Date.now(),
          }),
        }).catch(() => {});
        // #endregion

        await bridgeAuthUserToBrowserSession({
          hqUserId,
          email: user.email,
          displayName: user.name,
        });
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        if (typeof token.email === "string") {
          session.user.email = token.email;
        }
        if (typeof token.name === "string") {
          session.user.name = token.name;
        }
      }
      return session;
    },
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});

export async function requireAuthSession() {
  const session = await auth();
  if (!session?.user?.email) {
    return null;
  }

  const hqUserId = await ensureHqUserForAuthEmail(
    session.user.email,
    session.user.name,
  );

  await bridgeAuthUserToBrowserSession({
    hqUserId,
    email: session.user.email,
    displayName: session.user.name,
  });

  session.user.id = hqUserId;
  return session;
}
