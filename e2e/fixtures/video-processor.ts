import { nanoid } from "nanoid";

import type { Sql } from "./db";
import {
  acceptInviteViaApi,
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  type SessionFixture,
} from "./db";
import { ROLE_IDS } from "../../src/lib/rbac/constants";

export type RoleMemberFixture = SessionFixture;

/** Invite + accept a member with the given system role inside an alliance. */
export async function createMemberWithRole(
  sql: Sql,
  baseURL: string,
  input: {
    allianceId: string;
    roleName: keyof typeof ROLE_IDS;
    invitedByHqUserId: string;
  },
): Promise<RoleMemberFixture> {
  const email = `${input.roleName}-${nanoid(6)}@e2e.test`;
  const { token } = await createHqInviteRow(sql, {
    allianceId: input.allianceId,
    email,
    roleName: input.roleName,
    invitedByHqUserId: input.invitedByHqUserId,
  });
  const accepted = await acceptInviteViaApi(sql, baseURL, token, email);
  return {
    sessionId: accepted.sessionId,
    hqUserId: accepted.hqUserId,
    email,
    nextAuthToken: accepted.nextAuthToken,
  };
}

/** Directly grant a video processor slot (mirrors grantVideoProcessor). */
export async function grantProcessorSlot(
  sql: Sql,
  input: { allianceId: string; hqUserId: string; grantedByHqUserId: string | null },
): Promise<void> {
  await sql`
    INSERT INTO alliance_video_processors (
      id, alliance_id, hq_user_id, granted_by_hq_user_id, granted_at
    ) VALUES (
      ${nanoid(16)},
      ${input.allianceId},
      ${input.hqUserId},
      ${input.grantedByHqUserId ?? null},
      ${new Date()}
    )
  `;
}

/** Insert a job awaiting processor approval, owned by the given session/alliance. */
export async function insertPendingVideoJob(
  sql: Sql,
  input: {
    allianceId: string;
    sessionId: string;
    enqueuedByHqUserId: string | null;
    scoreTarget?: string;
  },
): Promise<string> {
  const jobId = nanoid(16);
  const now = new Date();
  const scoreTarget = input.scoreTarget ?? "desert-storm";
  await sql`
    INSERT INTO video_jobs (
      id, session_id, status, category, score_target, alliance_id,
      enqueued_by_hq_user_id, ingest_method, pass_role, created_at, updated_at
    ) VALUES (
      ${jobId},
      ${input.sessionId},
      ${"pending_approval"},
      ${scoreTarget},
      ${scoreTarget},
      ${input.allianceId},
      ${input.enqueuedByHqUserId ?? null},
      ${"video"},
      ${"primary"},
      ${now},
      ${now}
    )
  `;
  return jobId;
}

export async function loadVideoJobStatus(
  sql: Sql,
  jobId: string,
): Promise<string | null> {
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM video_jobs WHERE id = ${jobId} LIMIT 1
  `;
  return row?.status ?? null;
}

export type VideoProcessorScenario = {
  allianceId: string;
  owner: RoleMemberFixture;
  officer: RoleMemberFixture;
  processor: RoleMemberFixture;
};

/**
 * Builds an alliance with:
 *  - owner (hq:video:read + bypass-role processing, no Ashed credential)
 *  - officer (enqueue only, no processor slot, no Ashed)
 *  - processor (officer granted a processor slot, no Ashed)
 */
export async function createVideoProcessorScenario(
  sql: Sql,
  baseURL: string,
): Promise<VideoProcessorScenario> {
  const maintainer = await createPlatformMaintainerSession(sql);
  const alliance = await createNativeAlliance(sql, {
    tag: `VP${nanoid(4)}`,
    name: "Video Processor Alliance",
  });

  const owner = await createMemberWithRole(sql, baseURL, {
    allianceId: alliance.allianceId,
    roleName: "owner",
    invitedByHqUserId: maintainer.hqUserId,
  });
  const officer = await createMemberWithRole(sql, baseURL, {
    allianceId: alliance.allianceId,
    roleName: "officer",
    invitedByHqUserId: maintainer.hqUserId,
  });
  const processor = await createMemberWithRole(sql, baseURL, {
    allianceId: alliance.allianceId,
    roleName: "officer",
    invitedByHqUserId: maintainer.hqUserId,
  });
  await grantProcessorSlot(sql, {
    allianceId: alliance.allianceId,
    hqUserId: processor.hqUserId,
    grantedByHqUserId: owner.hqUserId,
  });

  return { allianceId: alliance.allianceId, owner, officer, processor };
}
