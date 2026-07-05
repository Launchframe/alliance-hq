import {
  countSignInMethods,
  type SignInMethodSnapshot,
} from "@/lib/auth/account-linking.shared";

export type QuickAccessMethod = "google" | "discord" | "passkey" | "email";

export type SignInMethodLinkedFlags = Record<QuickAccessMethod, boolean>;

export function resolveSignInMethodLinkedFlags(
  snapshot: SignInMethodSnapshot,
): SignInMethodLinkedFlags {
  const linked = new Set(snapshot.linkedProviders);
  return {
    google: linked.has("google"),
    discord: linked.has("discord"),
    passkey: snapshot.passkeyCount > 0,
    email: snapshot.email.trim().length > 0,
  };
}

export function canRemovePasskeys(methods: SignInMethodSnapshot): boolean {
  if (methods.passkeyCount <= 0) {
    return false;
  }
  return countSignInMethods({ ...methods, passkeyCount: 0 }) >= 1;
}
