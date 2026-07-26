import { nanoid } from "nanoid";

import type { Sql } from "./db";
import {
  acceptInviteViaApi,
  createHqInviteRow,
  createHqMemberLink,
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

/** Insert a roster member at R4/R5 and link them to an HQ user (native candidate pool). */
export async function seedLinkedRosterOfficer(
  sql: Sql,
  input: {
    allianceId: string;
    hqUserId: string;
    allianceRank: 4 | 5;
    allianceRankTitle?: string;
    memberDisplayName?: string;
  },
): Promise<{ ashedMemberId: string }> {
  const ashedMemberId = `e2e-rank-${nanoid(10)}`;
  const now = new Date();
  const displayName = input.memberDisplayName ?? `R${input.allianceRank} Commander`;
  await sql`
    INSERT INTO alliance_members (
      id, alliance_id, ashed_member_id, ashed_alliance_id, current_name, status,
      alliance_rank, alliance_rank_title, synced_at, created_at, updated_at
    ) VALUES (
      ${nanoid(16)},
      ${input.allianceId},
      ${ashedMemberId},
      ${`e2e-alliance-${input.allianceId}`},
      ${displayName},
      ${"active"},
      ${input.allianceRank},
      ${input.allianceRankTitle ?? null},
      ${now},
      ${now},
      ${now}
    )
  `;
  await createHqMemberLink(sql, {
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    ashedMemberId,
    memberDisplayName: displayName,
  });
  return { ashedMemberId };
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
  return insertAllianceVideoJob(sql, {
    ...input,
    status: "pending_approval",
  });
}

/** Insert an alliance-scoped video job at an arbitrary lifecycle status. */
export async function insertAllianceVideoJob(
  sql: Sql,
  input: {
    allianceId: string;
    sessionId: string;
    enqueuedByHqUserId: string | null;
    scoreTarget?: string;
    status: string;
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
      ${input.status},
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

export async function loadVideoJobPassKey(
  sql: Sql,
  jobId: string,
): Promise<string | null> {
  const [row] = await sql<{ pass_key: string | null }[]>`
    SELECT pass_key FROM video_jobs WHERE id = ${jobId} LIMIT 1
  `;
  return row?.pass_key ?? null;
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
  await seedLinkedRosterOfficer(sql, {
    allianceId: alliance.allianceId,
    hqUserId: processor.hqUserId,
    allianceRank: 4,
    allianceRankTitle: "Warlord",
  });
  await grantProcessorSlot(sql, {
    allianceId: alliance.allianceId,
    hqUserId: processor.hqUserId,
    grantedByHqUserId: owner.hqUserId,
  });

  return { allianceId: alliance.allianceId, owner, officer, processor };
}

/** Seed additional active roster members for VS expected-row heuristics. */
export async function seedRosterMemberBatch(
  sql: Sql,
  input: { allianceId: string; count: number },
): Promise<void> {
  const now = new Date();
  const ashedAllianceId = `e2e-alliance-${input.allianceId}`;
  for (let i = 0; i < input.count; i++) {
    await sql`
      INSERT INTO alliance_members (
        id, alliance_id, ashed_member_id, ashed_alliance_id, current_name, status,
        alliance_rank, synced_at, created_at, updated_at
      ) VALUES (
        ${nanoid(16)},
        ${input.allianceId},
        ${`e2e-roster-${nanoid(10)}`},
        ${ashedAllianceId},
        ${`Commander ${i + 1}`},
        ${"active"},
        ${1},
        ${now},
        ${now},
        ${now}
      )
    `;
  }
}

export type VsShadowWithholdFixture = {
  groupId: string;
  primaryJobId: string;
  shadowJobId: string;
  parseSessionId: string;
};

/** VS primary in review with thin parse + shadow pass still processing (withhold UX). */
export async function createVsShadowWithholdFixture(
  sql: Sql,
  input: {
    allianceId: string;
    sessionId: string;
    enqueuedByHqUserId: string;
    primaryRowCount?: number;
    shadowStatus?: string;
  },
): Promise<VsShadowWithholdFixture> {
  const now = new Date();
  const groupId = nanoid(16);
  const primaryJobId = nanoid(16);
  const shadowJobId = nanoid(16);
  const parseSessionId = nanoid(16);
  const primaryRowCount = input.primaryRowCount ?? 5;
  const shadowStatus = input.shadowStatus ?? "parsing";

  await sql`
    INSERT INTO video_upload_groups (
      id, session_id, alliance_id, score_target, primary_job_id,
      selected_job_id, created_at, updated_at
    ) VALUES (
      ${groupId},
      ${input.sessionId},
      ${input.allianceId},
      ${"vs-performance"},
      ${primaryJobId},
      ${primaryJobId},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO video_jobs (
      id, session_id, status, category, score_target, alliance_id,
      enqueued_by_hq_user_id, ingest_method, group_id, pass_role, pass_index,
      parse_session_id, frame_count, created_at, updated_at
    ) VALUES (
      ${primaryJobId},
      ${input.sessionId},
      ${"review"},
      ${"vs-performance"},
      ${"vs-performance"},
      ${input.allianceId},
      ${input.enqueuedByHqUserId},
      ${"video"},
      ${groupId},
      ${"primary"},
      ${0},
      ${parseSessionId},
      ${4},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO video_jobs (
      id, session_id, status, category, score_target, alliance_id,
      enqueued_by_hq_user_id, ingest_method, group_id, pass_role, pass_index,
      created_at, updated_at
    ) VALUES (
      ${shadowJobId},
      ${input.sessionId},
      ${shadowStatus},
      ${"vs-performance"},
      ${"vs-performance"},
      ${input.allianceId},
      ${input.enqueuedByHqUserId},
      ${"video"},
      ${groupId},
      ${"shadow"},
      ${1},
      ${now},
      ${now}
    )
  `;

  await sql`
    INSERT INTO parse_sessions (
      id, job_id, session_id, score_target, alliance_id,
      row_count, matched_count, status, created_at, updated_at
    ) VALUES (
      ${parseSessionId},
      ${primaryJobId},
      ${input.sessionId},
      ${"vs-performance"},
      ${input.allianceId},
      ${primaryRowCount},
      ${primaryRowCount},
      ${"open"},
      ${now},
      ${now}
    )
  `;

  for (let i = 0; i < primaryRowCount; i++) {
    await sql`
      INSERT INTO parsed_rows (
        id, parse_session_id, ocr_name, score, rank, deleted, edited,
        created_at, updated_at
      ) VALUES (
        ${nanoid(16)},
        ${parseSessionId},
        ${`Player ${i + 1}`},
        ${String(1000 + i)},
        ${i + 1},
        ${0},
        ${0},
        ${now},
        ${now}
      )
    `;
  }

  return { groupId, primaryJobId, shadowJobId, parseSessionId };
}

export async function setVideoJobStatus(
  sql: Sql,
  jobId: string,
  status: string,
): Promise<void> {
  await sql`
    UPDATE video_jobs SET status = ${status}, updated_at = ${new Date()}
    WHERE id = ${jobId}
  `;
}
