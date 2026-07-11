import { expect, test } from "@playwright/test";

import { authCookieHeader, getE2eSql } from "./fixtures/db";
import {
  createDataManagementScenario,
  insertDataUploadBatch,
  loadDataBatchStatus,
} from "./fixtures/data-management";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/**
 * Data Management batch CRUD RBAC.
 *
 *   owner / maintainer ── delete/move any active batch ───────────────▶ allowed (upstream may 503)
 *   officer ── delete/move own batch only ───────────────────────────▶ 403 on others' batches
 *   data_entry / viewer / member ── list only ──────────────────────▶ 403 on delete/move
 *
 * Positive assertions:
 *  - Officers see move/delete flags only on batches they uploaded.
 *  - Owners can attempt destructive actions on any batch in the alliance.
 *
 * Must NOT occur:
 *  - Officers deleting or moving another user's batch.
 *  - Lower-privilege roles mutating batch status locally after a forbidden delete attempt.
 */
test.describe("Data management batch RBAC", () => {
  test("officer can manage only their own batches", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());

    const ownBatchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
    });
    const otherBatchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerB.hqUserId,
      recordedDate: "2026-05-30",
    });

    const list = await request.get(
      "/api/data-management/batches?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect(list.status(), await list.text()).toBe(200);
    const listed = (await list.json()) as {
      batches: Array<{
        id: string;
        canDelete: boolean;
        canMove: boolean;
      }>;
    };
    const own = listed.batches.find((batch) => batch.id === ownBatchId);
    const other = listed.batches.find((batch) => batch.id === otherBatchId);
    expect(own?.canDelete).toBe(true);
    expect(own?.canMove).toBe(true);
    expect(other?.canDelete).toBe(false);
    expect(other?.canMove).toBe(false);

    const deleteOwn = await request.post(
      `/api/data-management/batches/${ownBatchId}/delete`,
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect([502, 503]).toContain(deleteOwn.status());

    const deleteOther = await request.post(
      `/api/data-management/batches/${otherBatchId}/delete`,
      { headers: { Cookie: authCookieHeader(scenario.officerA) } },
    );
    expect(deleteOther.status()).toBe(403);
    expect(await loadDataBatchStatus(sql, otherBatchId)).toBe("active");
  });

  test("owner can attempt delete on any batch", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());
    const batchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
    });

    const res = await request.post(
      `/api/data-management/batches/${batchId}/delete`,
      { headers: { Cookie: authCookieHeader(scenario.owner) } },
    );
    expect(res.status(), await res.text()).not.toBe(403);
    expect([502, 503]).toContain(res.status());
    expect(await loadDataBatchStatus(sql, batchId)).toBe("active");
  });

  test("data_entry cannot delete batches", async ({ request }) => {
    const sql = getE2eSql();
    const scenario = await createDataManagementScenario(sql, e2eBaseUrl());
    const batchId = await insertDataUploadBatch(sql, {
      allianceId: scenario.allianceId,
      createdByHqUserId: scenario.officerA.hqUserId,
    });

    const list = await request.get(
      "/api/data-management/batches?scoreTarget=desert-storm",
      { headers: { Cookie: authCookieHeader(scenario.dataEntry) } },
    );
    expect(list.status()).toBe(200);

    const del = await request.post(
      `/api/data-management/batches/${batchId}/delete`,
      { headers: { Cookie: authCookieHeader(scenario.dataEntry) } },
    );
    expect(del.status()).toBe(403);
    expect(await loadDataBatchStatus(sql, batchId)).toBe("active");
  });
});
