import "server-only";

import NextAuth from "next-auth";

import { createHqAuthAdapter } from "@/lib/auth/adapter";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import { syncDiscordHqLinkFromOAuthSignIn } from "@/lib/auth/discord-hq-link.server";
import { buildAuthProviders } from "@/lib/auth/providers.server";
import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";
import { maybeBootstrapPlatformMaintainer } from "@/lib/rbac/bootstrap-platform";
import {
  type OAuthAvatarProvider,
  syncOAuthProviderAvatar,
} from "@/lib/profile/resolve-avatar";
import { resolveBrowserSessionHqUserId } from "@/lib/session";

const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

function isOAuthProvider(
  provider: string | undefined,
): provider is OAuthAvatarProvider {
  return provider === "google" || provider === "discord";
}

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
  experimental: {
    enableWebAuthn: true,
  },
  providers: buildAuthProviders(),
  callbacks: {
    async signIn({ user, account }) {
      if (
        account?.provider === "password" ||
        account?.provider === "passkey" ||
        account?.provider === "email-code"
      ) {
        return Boolean(user.email);
      }
      if (isOAuthProvider(account?.provider)) {
        return Boolean(user.email);
      }
      // Magic-link send also invokes signIn before hq_users exists; do not bridge here.
      return Boolean(user.email);
    },
    async jwt({ token, user, account }) {
      if (user?.email) {
        const hqUserId = await ensureHqUserForAuthEmail(user.email, user.name);
        token.sub = hqUserId;
        token.email = user.email;
        token.name = user.name;

        if (
          isOAuthProvider(account?.provider) &&
          account.providerAccountId
        ) {
          await syncOAuthProviderAvatar(hqUserId, account.provider, {
            providerUserId: account.providerAccountId,
            avatarUrl: user.image,
          });
        }

        if (account?.provider === "discord" && account.providerAccountId) {
          await syncDiscordHqLinkFromOAuthSignIn({
            discordUserId: account.providerAccountId,
            hqUserId,
          });
        }

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
