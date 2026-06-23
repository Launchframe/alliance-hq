import "server-only";

import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Discord from "next-auth/providers/discord";
import Google from "next-auth/providers/google";
import Passkey from "next-auth/providers/passkey";
import Resend from "next-auth/providers/resend";

import {
  isMagicLinkLogOnly,
  logMagicLinkToStdout,
  sendMagicLinkViaResend,
  shouldLogMagicLinkToStdout,
} from "@/lib/auth/magic-link-email.server";
import { verifyPasswordLogin } from "@/lib/auth/password.server";
import {
  isDiscordOAuthConfigured,
  isGoogleOAuthConfigured,
} from "@/lib/auth/sso-config.server";
import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

function readOAuthClientId(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readOAuthClientSecret(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function buildAuthProviders(): Provider[] {
  const providers: Provider[] = [];

  if (isGoogleOAuthConfigured()) {
    providers.push(
      Google({
        clientId: readOAuthClientId("AUTH_GOOGLE_ID", "GOOGLE_CLIENT_ID")!,
        clientSecret: readOAuthClientSecret(
          "AUTH_GOOGLE_SECRET",
          "GOOGLE_CLIENT_SECRET",
        )!,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  if (isDiscordOAuthConfigured()) {
    providers.push(
      Discord({
        clientId: readOAuthClientId(
          "AUTH_DISCORD_ID",
          "DISCORD_CLIENT_ID",
          "DISCORD_APPLICATION_ID",
        )!,
        clientSecret: readOAuthClientSecret(
          "AUTH_DISCORD_SECRET",
          "DISCORD_CLIENT_SECRET",
        )!,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  providers.push(
    Credentials({
      id: "password",
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "");
        const password = String(credentials?.password ?? "");
        const user = await verifyPasswordLogin(email, password);
        if (!user) {
          return null;
        }
        return {
          id: user.id,
          email: user.email,
          name: user.displayName ?? undefined,
        };
      },
    }),
    Passkey,
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
  );

  return providers;
}
