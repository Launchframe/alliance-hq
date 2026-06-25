#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local" });

const DEV_FIXTURE = {
  allianceId: "dev-discord-auth-alliance",
  ashedAllianceId: "dev-discord-auth-ashed",
  allianceSlug: "dev-discord-auth",
  allianceTag: "DEV",
  allianceName: "Discord Auth Dev Alliance",
  gameServerNumber: 1203,
  guildId: process.env.DISCORD_DEV_GUILD_ID || "dev-guild-1",
  ownerDiscordUserId: process.env.DISCORD_DEV_USER_ID || "dev-user-1",
  ownerMemberId: "dev-owner-member",
  ownerName: "ColdStartOwner",
  ownerUid: "1234567890121203",
  memberId: "dev-member-two",
  memberName: "E2eNativeOwner",
  memberUid: "1234567890121203",
};

function resolveDatabaseUrl() {
  return (
    process.env.LOCAL_DATABASE_URL?.trim() ||
    process.env.E2E_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    ""
  );
}

function assertLocalDatabase(url) {
  if (process.env.VERCEL === "1" || process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed Discord auth fixtures in production.");
  }
  if (!url) {
    throw new Error("Set LOCAL_DATABASE_URL or E2E_DATABASE_URL before seeding.");
  }

  const allowRemote = process.env.DISCORD_DEV_SEED_ALLOW_REMOTE === "1";
  const host = new URL(url).hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocalhost && !allowRemote) {
    throw new Error(
      `Refusing to seed non-local database host "${host}". Set DISCORD_DEV_SEED_ALLOW_REMOTE=1 if this is an intentional disposable dev database.`,
    );
  }
}

async function main() {
  const databaseUrl = resolveDatabaseUrl();
  assertLocalDatabase(databaseUrl);

  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
  });

  const now = new Date();

  try {
    await sql.begin(async (tx) => {
      await tx`
        insert into alliances (
          id,
          slug,
          tag,
          name,
          ashed_alliance_id,
          owner_ashed_user_id,
          game_server_number,
          owner_member_external_id,
          current_season_key,
          operating_mode,
          created_at,
          updated_at
        )
        values (
          ${DEV_FIXTURE.allianceId},
          ${DEV_FIXTURE.allianceSlug},
          ${DEV_FIXTURE.allianceTag},
          ${DEV_FIXTURE.allianceName},
          ${DEV_FIXTURE.ashedAllianceId},
          ${DEV_FIXTURE.ownerMemberId},
          ${DEV_FIXTURE.gameServerNumber},
          ${DEV_FIXTURE.ownerMemberId},
          '1',
          'native',
          ${now},
          ${now}
        )
        on conflict (id) do update set
          tag = excluded.tag,
          name = excluded.name,
          ashed_alliance_id = excluded.ashed_alliance_id,
          owner_ashed_user_id = excluded.owner_ashed_user_id,
          game_server_number = excluded.game_server_number,
          owner_member_external_id = excluded.owner_member_external_id,
          current_season_key = excluded.current_season_key,
          operating_mode = excluded.operating_mode,
          updated_at = excluded.updated_at
      `;

      await tx`
        insert into alliance_members (
          id,
          alliance_id,
          ashed_member_id,
          ashed_alliance_id,
          current_name,
          previous_names_json,
          status,
          alliance_rank,
          alliance_rank_title,
          synced_at,
          created_at,
          updated_at
        )
        values
          (
            'dev-discord-auth-owner-row',
            ${DEV_FIXTURE.allianceId},
            ${DEV_FIXTURE.ownerMemberId},
            ${DEV_FIXTURE.ashedAllianceId},
            ${DEV_FIXTURE.ownerName},
            '[]'::jsonb,
            'active',
            5,
            'R5',
            ${now},
            ${now},
            ${now}
          ),
          (
            'dev-discord-auth-member-row',
            ${DEV_FIXTURE.allianceId},
            ${DEV_FIXTURE.memberId},
            ${DEV_FIXTURE.ashedAllianceId},
            ${DEV_FIXTURE.memberName},
            '[]'::jsonb,
            'active',
            4,
            'R4',
            ${now},
            ${now},
            ${now}
          )
        on conflict (alliance_id, ashed_member_id) do update set
          current_name = excluded.current_name,
          previous_names_json = excluded.previous_names_json,
          status = excluded.status,
          alliance_rank = excluded.alliance_rank,
          alliance_rank_title = excluded.alliance_rank_title,
          synced_at = excluded.synced_at,
          updated_at = excluded.updated_at
      `;

      await tx`
        insert into discord_guild_alliances (guild_id, alliance_id, registered_at)
        values (${DEV_FIXTURE.guildId}, ${DEV_FIXTURE.allianceId}, ${now})
        on conflict (guild_id) do update set
          alliance_id = excluded.alliance_id,
          registered_at = excluded.registered_at
      `;

      await tx`
        insert into discord_user_prefs (discord_user_id, locale, updated_at)
        values (${DEV_FIXTURE.ownerDiscordUserId}, 'en-US', ${now})
        on conflict (discord_user_id) do update set
          locale = excluded.locale,
          updated_at = excluded.updated_at
      `;
    });
  } finally {
    await sql.end();
  }

  console.log("Seeded Discord auth dev fixture:");
  console.log(`  Alliance: ${DEV_FIXTURE.allianceTag} (${DEV_FIXTURE.allianceId})`);
  console.log(`  Guild:    ${DEV_FIXTURE.guildId}`);
  console.log(`  User:     ${DEV_FIXTURE.ownerDiscordUserId}`);
  console.log(`  Owner:    ${DEV_FIXTURE.ownerName} / ${DEV_FIXTURE.ownerUid}`);
  console.log("");
  console.log("Suggested local env:");
  console.log(`  DISCORD_DEV_GUILD_ID=${DEV_FIXTURE.guildId}`);
  console.log(`  DISCORD_DEV_USER_ID=${DEV_FIXTURE.ownerDiscordUserId}`);
  console.log("  E2E_TEST=true");

  const eligibleTags = process.env.ELIGIBLE_BOT_ALLIANCE_LINK_TAGS?.trim();
  if (eligibleTags) {
    const allowed = eligibleTags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(DEV_FIXTURE.allianceTag.toLowerCase())) {
      console.log("");
      console.log(
        `WARNING: ELIGIBLE_BOT_ALLIANCE_LINK_TAGS="${eligibleTags}" does not include "${DEV_FIXTURE.allianceTag}".`,
      );
      console.log(
        `  /link-alliance and /link-to-ashed-seat will reject tag ${DEV_FIXTURE.allianceTag}.`,
      );
      console.log(
        `  Add ${DEV_FIXTURE.allianceTag} to the list or unset the variable, then restart the app.`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
