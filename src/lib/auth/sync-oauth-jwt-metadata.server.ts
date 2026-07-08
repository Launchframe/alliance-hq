import "server-only";

import type { LinkedOAuthProvider } from "@/lib/auth/account-linking.shared";
import { updateOAuthProviderEmail } from "@/lib/auth/account-linking.server";
import { syncDiscordHqLinkFromOAuthSignIn } from "@/lib/auth/discord-hq-link.server";
import {
  syncOAuthProviderAvatar,
  type OAuthAvatarProvider,
} from "@/lib/profile/resolve-avatar";

export type SyncOAuthJwtMetadataInput = {
  hqUserId: string;
  provider: OAuthAvatarProvider;
  providerAccountId: string;
  providerEmail?: string | null;
  avatarUrl?: string | null;
};

/** Avatar, provider email, and Discord HQ link sync shared by JWT callback paths. */
export async function syncOAuthJwtMetadata(
  input: SyncOAuthJwtMetadataInput,
): Promise<void> {
  const provider = input.provider as LinkedOAuthProvider;

  await updateOAuthProviderEmail({
    provider,
    providerAccountId: input.providerAccountId,
    providerEmail: input.providerEmail ?? null,
  });
  await syncOAuthProviderAvatar(input.hqUserId, input.provider, {
    providerUserId: input.providerAccountId,
    avatarUrl: input.avatarUrl,
  });
  if (provider === "discord") {
    await syncDiscordHqLinkFromOAuthSignIn({
      discordUserId: input.providerAccountId,
      hqUserId: input.hqUserId,
    });
  }
}
