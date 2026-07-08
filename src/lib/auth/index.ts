import "server-only";

import { cookies } from "next/headers";
import NextAuth from "next-auth";

import {
  findHqUserIdForOAuthAccount,
  linkOAuthAccountForSignedInUser,
  tryAutoLinkOAuthAtSignIn,
  updateOAuthProviderEmail,
} from "@/lib/auth/account-linking.server";
import { buildOAuthSignInRequiredAuthPath } from "@/lib/auth/email-sign-in-restriction.shared";
import { resolveEmailSignInRestrictionForEmail } from "@/lib/auth/email-sign-in-restriction.server";
import { createHqAuthAdapter } from "@/lib/auth/adapter";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";
import { syncDiscordHqLinkFromOAuthSignIn } from "@/lib/auth/discord-hq-link.server";
import {
  OAUTH_ACCOUNT_ALREADY_LINKED,
  OAUTH_ACCOUNT_NOT_LINKED,
  OAUTH_PROVIDER_TYPE_ALREADY_LINKED,
  oauthAccountLinkErrorRedirect,
} from "@/lib/auth/oauth-link-error-redirect.shared";
import { buildAuthProviders } from "@/lib/auth/providers.server";
import { ensureHqUserForAuthEmail } from "@/lib/auth/resolve-hq-user";
import { loadHqUserEmailById } from "@/lib/auth/change-hq-email.server";
import { resolveSessionHqUserId } from "@/lib/auth/resolve-session-hq-user.server";
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

/** Honor the page that started OAuth linking (Auth.js callback-url cookie). */
async function resolveOAuthAccountLinkErrorRedirect(
  linkError: string = OAUTH_ACCOUNT_NOT_LINKED,
): Promise<string> {
  const jar = await cookies();
  const callbackUrl =
    jar.get("__Secure-authjs.callback-url")?.value ??
    jar.get("authjs.callback-url")?.value ??
    null;
  return oauthAccountLinkErrorRedirect(callbackUrl, linkError);
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
    async signIn({ user, account, profile }) {
      if (account?.provider === "password" || account?.provider === "passkey") {
        return Boolean(user.email);
      }

      if (account?.provider === "email-code" || account?.provider === "resend") {
        if (!user.email) {
          return false;
        }
        const restriction = await resolveEmailSignInRestrictionForEmail(user.email);
        if (restriction.blocked) {
          return buildOAuthSignInRequiredAuthPath(restriction);
        }
        return true;
      }

      if (isOAuthProvider(account?.provider)) {
        if (!account?.providerAccountId) {
          return false;
        }

        const session = await auth();
        if (session?.user?.id) {
          const linkResult = await linkOAuthAccountForSignedInUser({
            hqUserId: session.user.id,
            account,
            providerEmail: user.email,
          });

          if (!linkResult.ok) {
            const linkError =
              linkResult.code === "provider_account_on_other_user"
                ? OAUTH_ACCOUNT_ALREADY_LINKED
                : OAUTH_PROVIDER_TYPE_ALREADY_LINKED;
            return resolveOAuthAccountLinkErrorRedirect(linkError);
          }

          return true;
        }

        const existingOwnerId = await findHqUserIdForOAuthAccount({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        });
        if (existingOwnerId) {
          return true;
        }

        if (!user.email) {
          return false;
        }

        const { allowed, decision } = await tryAutoLinkOAuthAtSignIn({
          provider: account.provider,
          oauthEmail: user.email,
          profile: profile as Record<string, unknown> | undefined,
          account,
        });

        if (!allowed) {
          console.warn("[auth] OAuth cold sign-in blocked", {
            provider: account.provider,
            decision,
          });
          return "/auth?error=OAuthAccountNotLinked";
        }

        return true;
      }
      // Magic-link send also invokes signIn before hq_users exists; do not bridge here.
      return Boolean(user.email);
    },
    async jwt({ token, user, account, trigger, session }) {
      if (
        trigger === "update" &&
        session &&
        typeof session === "object" &&
        "email" in session &&
        typeof session.email === "string" &&
        session.email.trim()
      ) {
        token.email = session.email.trim();
      }

      const signedInSession = await auth();
      const signedInHqUserId = signedInSession?.user?.id?.trim() || null;

      if (signedInHqUserId && isOAuthProvider(account?.provider)) {
        token.sub = signedInHqUserId;
        if (account?.providerAccountId) {
          await updateOAuthProviderEmail({
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            providerEmail: user?.email ?? null,
          });
          await syncOAuthProviderAvatar(signedInHqUserId, account.provider, {
            providerUserId: account.providerAccountId,
            avatarUrl: user?.image,
          });
          if (account.provider === "discord") {
            await syncDiscordHqLinkFromOAuthSignIn({
              discordUserId: account.providerAccountId,
              hqUserId: signedInHqUserId,
            });
          }
        }
        const email =
          typeof signedInSession?.user?.email === "string"
            ? signedInSession.user.email
            : undefined;
        if (email) {
          token.email = email;
          await bridgeAuthUserToBrowserSession({
            hqUserId: signedInHqUserId,
            email,
            displayName:
              typeof signedInSession?.user?.name === "string"
                ? signedInSession.user.name
                : undefined,
          });
        }
        return token;
      }


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
          await updateOAuthProviderEmail({
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            providerEmail: user.email,
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
      } else if (
        account?.provider === "discord" &&
        account.providerAccountId &&
        typeof token.sub === "string" &&
        token.sub.trim()
      ) {
        const hqUserId = token.sub.trim();
        await syncOAuthProviderAvatar(hqUserId, "discord", {
          providerUserId: account.providerAccountId,
          avatarUrl: user?.image,
        });
        await syncDiscordHqLinkFromOAuthSignIn({
          discordUserId: account.providerAccountId,
          hqUserId,
        });
        const email = typeof token.email === "string" ? token.email : undefined;
        if (email) {
          await bridgeAuthUserToBrowserSession({
            hqUserId,
            email,
            displayName: typeof token.name === "string" ? token.name : undefined,
          });
        }
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
  if (!session?.user) {
    return null;
  }

  const hqUserId = await resolveSessionHqUserId(session);
  if (!hqUserId) {
    return null;
  }

  const email =
    (await loadHqUserEmailById(hqUserId)) ?? session.user.email?.trim() ?? null;
  if (!email) {
    return null;
  }

  await bridgeAuthUserToBrowserSession({
    hqUserId,
    email,
    displayName: session.user.name,
  });

  session.user.id = await resolveBrowserSessionHqUserId(hqUserId);
  session.user.email = email;
  return session;
}
