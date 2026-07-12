import { nanoid } from "nanoid";

import type { Sql } from "./db";
import {
  acceptInviteViaApi,
  createAshedAlliance,
  createHqInviteRow,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  type SessionFixture,
} from "./db";

export type ViewOnlyMemberFixture = SessionFixture & {
  allianceId: string;
  tag: string;
  ashedMemberId: string;
  commanderId: string;
};

/** Minimal Commander + roster membership so member-scoped pages resolve commanderId. */
async function insertCommanderMembership(
  sql: Sql,
  input: { allianceId: string; ashedMemberId: string; primaryName: string },
): Promise<{ commanderId: string }> {
  const now = new Date();
  const commanderId = nanoid(16);

  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, current_alliance_id, created_at, updated_at
    ) VALUES (
      ${commanderId},
      ${input.primaryName},
      ${input.primaryName.toLowerCase()},
      ${input.allianceId},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO commander_alliance_memberships (
      id, commander_id, alliance_id, ashed_member_id, status, joined_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${commanderId},
      ${input.allianceId},
      ${input.ashedMemberId},
      'active',
      ${now},
      ${now},
      ${now}
    )
  `;

  return { commanderId };
}

export async function createViewOnlyMember(
  sql: Sql,
  baseURL: string,
  options: {
    operatingMode: "native" | "ashed";
    roleName?: "member" | "viewer";
  },
): Promise<ViewOnlyMemberFixture> {
  const maintainer = await createPlatformMaintainerSession(sql);
  const createAlliance =
    options.operatingMode === "native"
      ? createNativeAlliance
      : createAshedAlliance;
  const alliance = await createAlliance(sql, {
    tag: `VO${nanoid(4)}`,
    name: `View Only ${options.operatingMode} Alliance`,
  });
  const email = `viewer-${nanoid(6)}@e2e.test`;
  const { token } = await createHqInviteRow(sql, {
    allianceId: alliance.allianceId,
    email,
    roleName: options.roleName ?? "member",
    invitedByHqUserId: maintainer.hqUserId,
  });

  const accepted = await acceptInviteViaApi(sql, baseURL, token, email);
  // Commander identity is required for /my-vr writes (commander_season_vr) and
  // other member-scoped HQ pages; it does not require a personal Ashed session.
  const { ashedMemberId } = await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: accepted.hqUserId,
  });
  const { commanderId } = await insertCommanderMembership(sql, {
    allianceId: alliance.allianceId,
    ashedMemberId,
    primaryName: "E2E Commander",
  });

  return {
    sessionId: accepted.sessionId,
    hqUserId: accepted.hqUserId,
    email,
    nextAuthToken: accepted.nextAuthToken,
    allianceId: alliance.allianceId,
    tag: alliance.tag,
    ashedMemberId,
    commanderId,
  };
}
