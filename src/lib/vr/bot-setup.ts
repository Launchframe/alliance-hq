import {
  filterAccessibleAlliances,
  userAllianceAccessRole,
} from "@/lib/alliance/accessible";
import { base44ListAlliances } from "@/lib/base44/fetch";
import { verifyBase44Connection } from "@/lib/base44/server";
import {
  createDiscordTranslator,
  setDiscordBotLocale,
  type DiscordBotLocale,
  type DiscordTranslate,
} from "@/lib/discord/i18n";
import { parseConnectionInput } from "@/lib/connectionString";
import { encryptSecret } from "@/lib/crypto/encrypt";
import { syncAshedAllianceForBot } from "@/lib/rbac/sync-ashed-roles";
import {
  callerIsAllianceOwner,
  getAllianceById,
  listDiscordLinksForUserAnyAlliance,
  saveDiscordBotPending,
  resolveAllianceForGuild,
  updateAllianceSeasonKey,
  upsertAllianceAshedCredential,
  upsertGuildAlliance,
  writeDiscordBotAudit,
} from "@/lib/vr/repository";
import { resolveAllianceByTag } from "@/lib/vr/resolve-alliance-tag";
import type { LinkPendingState } from "@/lib/vr/types";

export type BotReply = { reply: string };

async function audit(
  allianceId: string | null,
  discordUserId: string,
  command: string,
  payload: unknown,
  result: unknown,
) {
  if (!allianceId) return;
  try {
    await writeDiscordBotAudit({
      allianceId,
      discordUserId,
      command,
      payload: sanitizeAuditPayload(payload),
      result,
    });
  } catch (error) {
    console.error("[discord-bot] audit log failed", error);
  }
}

function sanitizeAuditPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const copy = { ...(payload as Record<string, unknown>) };
  if ("key" in copy) copy.key = "[redacted]";
  if ("connectionKey" in copy) copy.connectionKey = "[redacted]";
  return copy;
}

async function resolveTagForSetup(input: {
  tag: string;
  discordUserId: string;
  allianceName?: string;
  translate: DiscordTranslate;
}): Promise<
  | { ok: true; allianceId: string; tag: string; name: string }
  | { ok: false; reply: string; pending?: LinkPendingState | null }
> {
  const resolved = await resolveAllianceByTag(input.tag, {
    discordUserId: input.discordUserId,
    allianceName: input.allianceName,
  });

  if (resolved.ok) {
    return {
      ok: true,
      allianceId: resolved.alliance.id,
      tag: resolved.alliance.tag,
      name: resolved.alliance.name,
    };
  }

  if (resolved.reason === "not_found") {
    return {
      ok: false,
      reply: input.translate("errors.tagNotFound", { tag: input.tag.trim() }),
    };
  }

  const pending: LinkPendingState = {
    kind: "pick_alliance_by_name",
    tag: input.tag.trim(),
    candidates: (resolved.candidates ?? []).map((c) => ({
      allianceId: c.id,
      name: c.name,
      tag: c.tag,
    })),
  };

  return {
    ok: false,
    reply: input.translate("errors.tagAmbiguous", { tag: input.tag.trim() }),
    pending,
  };
}

export async function handleDiscordLinkAlliance(input: {
  guildId: string;
  discordUserId: string;
  tag: string;
  allianceName?: string;
  locale: DiscordBotLocale;
}): Promise<BotReply & { pending?: LinkPendingState | null }> {
  const t = createDiscordTranslator(input.locale);
  const tag = input.tag?.trim();
  if (!tag) {
    const reply = t("errors.tagNotFound", { tag: "?" });
    await audit(null, input.discordUserId, "link_alliance", input, { reply });
    return { reply };
  }

  const userLinks = await listDiscordLinksForUserAnyAlliance(input.discordUserId);
  if (userLinks.length === 0) {
    const reply = t("errors.linkFirst");
    await audit(null, input.discordUserId, "link_alliance", input, { reply });
    return { reply };
  }

  const allianceName = input.allianceName?.trim();

  const resolved = await resolveTagForSetup({
    tag,
    discordUserId: input.discordUserId,
    allianceName,
    translate: t,
  });

  if (!resolved.ok) {
    if (resolved.pending?.kind === "pick_alliance_by_name") {
      await saveDiscordBotPending(
        resolved.pending.candidates[0]?.allianceId ?? userLinks[0]!.allianceId,
        input.discordUserId,
        resolved.pending,
      );
    }
    await audit(null, input.discordUserId, "link_alliance", input, resolved);
    return { reply: resolved.reply, pending: resolved.pending ?? null };
  }

  const isOwner = await callerIsAllianceOwner({
    allianceId: resolved.allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) {
    const reply = t("errors.notOwner");
    await audit(resolved.allianceId, input.discordUserId, "link_alliance", input, {
      reply,
    });
    return { reply };
  }

  await upsertGuildAlliance(input.guildId, resolved.allianceId);
  await saveDiscordBotPending(resolved.allianceId, input.discordUserId, null);

  const reply = t("setup.linkAllianceSuccess", { tag: resolved.tag });
  await audit(resolved.allianceId, input.discordUserId, "link_alliance", input, {
    reply,
  });
  return { reply };
}

export async function handleDiscordLinkWithAuthentication(input: {
  guildId: string;
  discordUserId: string;
  tag: string;
  connectionKey: string;
  allianceName?: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const tag = input.tag?.trim();
  const connectionKey = input.connectionKey?.trim();

  if (!tag || !connectionKey) {
    const reply = !tag
      ? t("errors.tagNotFound", { tag: "?" })
      : t("errors.invalidConnection", { error: "missing key" });
    await audit(null, input.discordUserId, "link_with_authentication", input, {
      reply,
    });
    return { reply };
  }

  const parsed = parseConnectionInput(connectionKey);
  if (!parsed.ok) {
    const reply = t("errors.invalidConnection", { error: parsed.error });
    await audit(null, input.discordUserId, "link_with_authentication", input, {
      reply,
    });
    return { reply };
  }

  let me;
  try {
    me = await verifyBase44Connection(parsed.connection);
  } catch (error) {
    const reply = t("errors.invalidConnection", {
      error: error instanceof Error ? error.message : "verification failed",
    });
    await audit(null, input.discordUserId, "link_with_authentication", input, {
      reply,
    });
    return { reply };
  }

  if (!me.email?.trim()) {
    const reply = t("errors.invalidConnection", { error: "missing email on token" });
    await audit(null, input.discordUserId, "link_with_authentication", input, {
      reply,
    });
    return { reply };
  }

  const currentUser = {
    email: me.email,
    id: me.id,
    full_name: me.full_name,
  };

  const alliances = await base44ListAlliances(parsed.connection);
  const accessible = filterAccessibleAlliances(alliances, currentUser);
  const tagLower = tag.toLowerCase();
  const ashedAlliance = accessible.find(
    (row) => row.tag.trim().toLowerCase() === tagLower,
  );

  if (!ashedAlliance) {
    const reply = t("errors.notAllianceOwner", { tag });
    await audit(null, input.discordUserId, "link_with_authentication", input, {
      reply,
    });
    return { reply };
  }

  const ashedRow = alliances.find((row) => row.id === ashedAlliance.id);
  const accessRole = ashedRow ? userAllianceAccessRole(ashedRow, currentUser) : null;
  if (accessRole !== "owner") {
    const reply = t("errors.notAllianceOwner", { tag });
    await audit(null, input.discordUserId, "link_with_authentication", input, {
      reply,
    });
    return { reply };
  }

  const { hqAllianceId, hqUserId } = await syncAshedAllianceForBot({
    connection: parsed.connection,
    allianceTag: tag,
    currentUser,
  });

  await upsertAllianceAshedCredential({
    allianceId: hqAllianceId,
    appId: parsed.connection.appId,
    originUrl: parsed.connection.originUrl,
    encryptedToken: encryptSecret(parsed.connection.token),
    registeredByDiscordUserId: input.discordUserId,
    registeredByHqUserId: hqUserId,
  });

  if (accessRole === "owner") {
    await upsertGuildAlliance(input.guildId, hqAllianceId);
  }

  await saveDiscordBotPending(hqAllianceId, input.discordUserId, null);

  const reply = t("setup.linkAuthSuccess", { tag: ashedAlliance.tag });
  await audit(hqAllianceId, input.discordUserId, "link_with_authentication", input, {
    reply,
  });
  return { reply };
}

export async function handleDiscordSetSeason(input: {
  guildId: string;
  discordUserId: string;
  season: number;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  const t = createDiscordTranslator(input.locale);
  const allianceId = await resolveAllianceForGuild(input.guildId);
  if (!allianceId) {
    const reply = t("errors.guildNotRegistered");
    await audit(null, input.discordUserId, "set_season", input, { reply });
    return { reply };
  }

  if (!Number.isInteger(input.season) || input.season < 1) {
    const reply = t("errors.invalidSeason");
    await audit(allianceId, input.discordUserId, "set_season", input, { reply });
    return { reply };
  }

  const isOwner = await callerIsAllianceOwner({
    allianceId,
    discordUserId: input.discordUserId,
  });
  if (!isOwner) {
    const reply = t("errors.notOwner");
    await audit(allianceId, input.discordUserId, "set_season", input, { reply });
    return { reply };
  }

  const seasonKey = String(input.season);
  await updateAllianceSeasonKey(allianceId, seasonKey);

  const alliance = await getAllianceById(allianceId);
  const reply = t("setup.setSeasonSuccess", {
    tag: alliance?.tag ?? "alliance",
    season: seasonKey,
  });
  await audit(allianceId, input.discordUserId, "set_season", input, { reply });
  return { reply };
}

export async function handleDiscordLanguage(input: {
  discordUserId: string;
  locale: DiscordBotLocale;
}): Promise<BotReply> {
  await setDiscordBotLocale(input.discordUserId, input.locale);
  const t = createDiscordTranslator(input.locale);
  return { reply: t("setup.languageSuccess") };
}
