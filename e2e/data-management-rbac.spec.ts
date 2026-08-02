import { expect, test } from "@playwright/test";

import { authCookieHeader, createBrowserSession, getE2eSql } from "./fixtures/db";
import {
  createDataManagementScenario,
  insertDataUploadBatch,
  loadDataBatchStatus,
} from "./fixtures/data-management";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/**
 * Data Management date-level CRUD RBAC (mirrors Ashed: one date, all teams).
 *
 *   owner / maintainer ── delete/move any date ───────────────────────▶ allowed (upstream may 503)
 *   officer ── delete/move date only when all ledger batches on that date are theirs
 *   data_entry / viewer / member ── list only ──────────────────────▶ 403 on delete/move
 */
test.describe("Data management date RBAC", () => {
  test("officer can manage only dates they fully own in the ledger", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());

    const ownBatchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
      recordedDate: "2026-05-29",
    });
    const otherBatchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerB.hqUserId,
      recordedDate: "2026-05-30",
    });

    const list = await request.get(
      "/api/data-management/dates?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect(list.status(), await list.text()).toBe(200);
    const listed = (await list.json()) as {
      dates: Array<{
        recordedDate: string;
        canDelete: boolean;
        canMove: boolean;
      }>;
    };
    const ownDate = listed.dates.find((date) => date.recordedDate === "2026-05-29");
    const otherDate = listed.dates.find((date) => date.recordedDate === "2026-05-30");
    expect(ownDate?.canDelete).toBe(true);
    expect(ownDate?.canMove).toBe(true);
    expect(otherDate?.canDelete).toBe(false);
    expect(otherDate?.canMove).toBe(false);

    const deleteOwn = await request.post(
      "/api/data-management/dates/2026-05-29/delete?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect([502, 503]).toContain(deleteOwn.status());

    const deleteOther = await request.post(
      "/api/data-management/dates/2026-05-30/delete?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect(deleteOther.status()).toBe(403);
    expect(await loadDataBatchStatus(sql, otherBatchId)).toBe("active");
    expect(await loadDataBatchStatus(sql, ownBatchId)).toBe("active");
  });

  test("officer cannot delete a date shared with another officer's ledger batch", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());
    const sharedDate = "2026-06-15";

    const ownBatchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
      recordedDate: sharedDate,
      contextJson: { team: "A" },
    });
    const otherBatchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerB.hqUserId,
      recordedDate: sharedDate,
      contextJson: { team: "B" },
    });

    const list = await request.get(
      "/api/data-management/dates?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect(list.status()).toBe(200);
    const listed = (await list.json()) as {
      dates: Array<{
        recordedDate: string;
        canDelete: boolean;
        canMove: boolean;
      }>;
    };
    const shared = listed.dates.find((date) => date.recordedDate === sharedDate);
    expect(shared?.canDelete).toBe(false);
    expect(shared?.canMove).toBe(false);

    const deleteShared = await request.post(
      `/api/data-management/dates/${sharedDate}/delete?scoreTarget=desert-storm`,
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect(deleteShared.status()).toBe(403);
    expect(await loadDataBatchStatus(sql, ownBatchId)).toBe("active");
    expect(await loadDataBatchStatus(sql, otherBatchId)).toBe("active");
  });

  test("owner can attempt delete on any date", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());
    const batchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
      recordedDate: "2026-05-29",
    });

    const res = await request.post(
      "/api/data-management/dates/2026-05-29/delete?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.owner) } },
    );
    expect(res.status(), await res.text()).not.toBe(403);
    expect([502, 503]).toContain(res.status());
    expect(await loadDataBatchStatus(sql, batchId)).toBe("active");
  });

  test("data_entry cannot delete dates", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());
    const batchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
      recordedDate: "2026-05-29",
    });

    const list = await request.get(
      "/api/data-management/dates?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.dataEntry) } },
    );
    expect(list.status()).toBe(200);

    const del = await request.post(
      "/api/data-management/dates/2026-05-29/delete?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.dataEntry) } },
    );
    expect(del.status()).toBe(403);
    expect(await loadDataBatchStatus(sql, batchId)).toBe("active");
  });

  test("anonymous workspace session (no hq_user_id) cannot list or delete batches", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());
    const batchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
    });

    // Anonymous browser session bound to the alliance but with no linked HQ
    // user — regression guard for the removed "legacy allow-all" RBAC
    // fallback that used to grant this shape owner-level alliance:admin.
    const { sessionId } = await createBrowserSession(sql, { hqUserId: null });
    await sql`
      UPDATE sessions
      SET alliance_id = ${scenario.allianceId},
          current_alliance_id = ${scenario.allianceId}
      WHERE id = ${sessionId}
    `;
    const anonymousCookie = `alliance_hq_session=${sessionId}`;

    const list = await request.get(
      "/api/data-management/batches?scoreTarget=desert-storm",
      { headers: { Cookie: anonymousCookie } },
    );
    expect(list.status(), await list.text()).toBe(403);

    const del = await request.post(
      `/api/data-management/batches/${batchId}/delete`,
      { headers: { Cookie: anonymousCookie } },
    );
    expect(del.status(), await del.text()).toBe(403);
    expect(await loadDataBatchStatus(sql, batchId)).toBe("active");
  });
});
