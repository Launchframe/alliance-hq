import { nanoid } from "nanoid";

import type { Sql } from "./db";
import {
  createPlatformMaintainerSession,
  createNativeAlliance,
  type SessionFixture,
} from "./db";
import {
  createMemberWithRole,
  type RoleMemberFixture,
} from "./video-processor";

export type DataManagementScenario = {
  allianceId: string;
  owner: RoleMemberFixture;
  officerA: RoleMemberFixture;
  officerB: RoleMemberFixture;
  dataEntry: RoleMemberFixture;
};

export async function createDataManagementScenario(
  sql: Sql,
  baseURL: string,
): Promise<DataManagementScenario> {
  const maintainer = await createPlatformMaintainerSession(sql);
  const alliance = await createNativeAlliance(sql, {
    tag: `DM${nanoid(4)}`,
    name: "Data Management Alliance",
  });

  const owner = await createMemberWithRole(sql, baseURL, {
    allianceId: alliance.allianceId,
    roleName: "owner",
    invitedByHqUserId: maintainer.hqUserId,
  });
  const officerA = await createMemberWithRole(sql, baseURL, {
    allianceId: alliance.allianceId,
    roleName: "officer",
    invitedByHqUserId: maintainer.hqUserId,
  });
  const officerB = await createMemberWithRole(sql, baseURL, {
    allianceId: alliance.allianceId,
    roleName: "officer",
    invitedByHqUserId: maintainer.hqUserId,
  });
  const dataEntry = await createMemberWithRole(sql, baseURL, {
    allianceId: alliance.allianceId,
    roleName: "data_entry",
    invitedByHqUserId: maintainer.hqUserId,
  });

  return {
    allianceId: alliance.allianceId,
    owner,
    officerA,
    officerB,
    dataEntry,
  };
}

export async function insertDataUploadBatch(
  sql: Sql,
  input: {
    allianceId: string;
    createdByHqUserId: string;
    recordedDate?: string;
    scoreTarget?: string;
    submitEntity?: string;
    rowCount?: number;
  },
): Promise<string> {
  const id = nanoid(16);
  const now = new Date();
  const recordedDate = input.recordedDate ?? "2026-05-29";
  const scoreTarget = input.scoreTarget ?? "desert-storm";
  const submitEntity = input.submitEntity ?? "DesertStormScore";
  const rowCount = input.rowCount ?? 49;

  await sql`
    INSERT INTO data_upload_batches (
      id,
      alliance_id,
      score_target,
      submit_entity,
      recorded_date,
      context_json,
      row_count,
      created_by_hq_user_id,
      submitted_at,
      status,
      created_at,
      updated_at
    ) VALUES (
      ${id},
      ${input.allianceId},
      ${scoreTarget},
      ${submitEntity},
      ${recordedDate},
      ${sql.json({ eventId: "event-1", team: "A" })},
      ${rowCount},
      ${input.createdByHqUserId},
      ${now},
      ${"active"},
      ${now},
      ${now}
    )
  `;

  return id;
}

export async function loadDataBatchStatus(
  sql: Sql,
  batchId: string,
): Promise<string | null> {
  const [row] = await sql<{ status: string }[]>`
    SELECT status FROM data_upload_batches WHERE id = ${batchId} LIMIT 1
  `;
  return row?.status ?? null;
}

export type ListedBatch = {
  id: string;
  canMove: boolean;
  canDelete: boolean;
};

export async function listBatchesForActor(
  baseURL: string,
  actor: SessionFixture,
): Promise<ListedBatch[]> {
  const res = await fetch(
    `${baseURL}/api/data-management/batches?scoreTarget=desert-storm`,
    {
      headers: {
        Cookie: `alliance_hq_session=${actor.sessionId}; authjs.session-token=${actor.nextAuthToken}`,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`list batches failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { batches: ListedBatch[] };
  return body.batches;
}
