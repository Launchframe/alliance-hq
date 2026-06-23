import "server-only";

import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { createHqAuthAdapter } from "@/lib/auth/adapter";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import {
  isMagicLinkLogOnly,
  logMagicLinkToStdout,
  sendMagicLinkViaResend,
  shouldLogMagicLinkToStdout,
} from "@/lib/auth/magic-link-email.server";
import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";
import { maybeBootstrapPlatformMaintainer } from "@/lib/rbac/bootstrap-platform";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";
import { resolveBrowserSessionHqUserId } from "@/lib/session";

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
      from:
        process.env.EMAIL_FROM ??
        (process.env.NODE_ENV === "production"
          ? PRODUCTION_EMAIL_FROM
          : RESEND_DEV_EMAIL_FROM),
      apiKey: process.env.RESEND_API_KEY,
      async sendVerificationRequest({ identifier: to, provider, url, theme }) {
        const devLog = shouldLogMagicLinkToStdout();
        if (devLog) {
          logMagicLinkToStdout(to, url);
          if (isMagicLinkLogOnly()) {
            return;
          }
        }

        try {
          await sendMagicLinkViaResend({
            to,
            url,
            from: String(provider.from),
            apiKey: provider.apiKey,
            theme,
          });
        } catch (error) {
          if (devLog) {
            console.warn(
              "[alliance-hq] Resend send failed in dev; use the magic link printed above.",
              error instanceof Error ? error.message : error,
            );
            return;
          }
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Magic-link send also invokes signIn before hq_users exists; do not bridge here.
      return Boolean(user.email);
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const hqUserId = await ensureHqUserForAuthEmail(user.email, user.name);
        token.sub = hqUserId;
        token.email = user.email;
        token.name = user.name;

        await bridgeAuthUserToBrowserSession({
          hqUserId,
          email: user.email,
          displayName: user.name,
        });
        await maybeBootstrapPlatformMaintainer(hqUserId, user.email);
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

  session.user.id = await resolveBrowserSessionHqUserId(hqUserId);
  return session;
}
