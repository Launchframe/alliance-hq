import "server-only";

import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { createHqAuthAdapter } from "@/lib/auth/adapter";
import { bridgeAuthUserToBrowserSession } from "@/lib/auth/bridge-session";

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
      if (!user.id || !user.email) {
        return false;
      }
      await bridgeAuthUserToBrowserSession({
        hqUserId: user.id,
        email: user.email,
        displayName: user.name,
      });
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
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
  if (!session?.user?.id || !session.user.email) {
    return null;
  }
  await bridgeAuthUserToBrowserSession({
    hqUserId: session.user.id,
    email: session.user.email,
    displayName: session.user.name,
  });
  return session;
}
