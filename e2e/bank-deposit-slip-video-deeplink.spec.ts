import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";

import {
  DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY,
} from "../src/lib/banks/deposit-slip-upload-context.shared";
import {
  authCookieHeader,
  attachAshedConnectionToSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import {
  createVideoProcessorScenario,
  insertPendingVideoJob,
} from "./fixtures/video-processor";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

async function insertBank(
  sql: ReturnType<typeof getE2eSql>,
  allianceId: string,
): Promise<string> {
  const bankId = `bank_${nanoid(10)}`;
  const now = new Date();
  await sql`
    INSERT INTO banks (
      id, alliance_id, game_server_number, coord_x, coord_y, level,
      prior_capture_count, created_at, updated_at
    ) VALUES (
      ${bankId},
      ${allianceId},
      ${1211},
      ${699},
      ${499},
      ${8},
      ${0},
      ${now},
      ${now}
    )
  `;
  return bankId;
}

test.describe("Bank deposit slip video deep-link + OCR lock", () => {
  test("bank management Video link opens deposit-slip upload with bankId", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const bankId = await insertBank(sql, scenario.allianceId);

    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto("/bank-management");
    await expect(
      page.getByRole("heading", { name: /bank management/i }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: /upload deposit slip video/i })
      .click();

    await expect(page).toHaveURL(/\/tools\/video-upload/);
    const url = new URL(page.url());
    expect(url.searchParams.get("scoreTarget")).toBe(
      "bank-deposit-slip-history",
    );
    expect(url.searchParams.get("bankId")).toBe(bankId);
    await expect(
      page.getByLabel("What leaderboard is this?"),
    ).toBeVisible();

    const preferred = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      DEPOSIT_SLIP_PREFERRED_BANK_STORAGE_KEY,
    );
    expect(preferred).toBe(bankId);
  });

  test("process-preview locks in-house OCR for deposit-slip score target", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: "bank-deposit-slip-history",
    });

    const res = await request.get(
      `/api/tools/video-upload/${jobId}/process-preview`,
      { headers: { Cookie: authCookieHeader(scenario.processor) } },
    );
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as {
      hqOcrOnly: boolean;
      hqOcrOnlyLocked: boolean;
      hqOcrOnlyLockReason: string | null;
      scoreTarget: string | null;
    };
    expect(body.scoreTarget).toBe("bank-deposit-slip-history");
    expect(body.hqOcrOnly).toBe(true);
    expect(body.hqOcrOnlyLocked).toBe(true);
    expect(body.hqOcrOnlyLockReason).toBe("score_target");
  });

  test("process panel shows score-target OCR lock hint for deposit-slip jobs", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    const jobId = await insertPendingVideoJob(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
      scoreTarget: "bank-deposit-slip-history",
    });
    await attachAshedConnectionToSession(sql, scenario.processor.sessionId);

    await page.context().addCookies(playwrightAuthCookies(scenario.processor));
    await page.goto(`/tools/video-upload?processJob=${jobId}`);

    const panel = page.getByTestId("video-process-after-upload-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/bank-deposit-slip-history/i)).toBeVisible();

    const ocrCheckbox = panel.locator('input[type="checkbox"]').first();
    await expect(ocrCheckbox).toBeChecked();
    await expect(ocrCheckbox).toBeDisabled();
    await expect(
      panel.getByText(/always uses Alliance HQ in-house OCR/i),
    ).toBeVisible();
  });
});
