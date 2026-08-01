import { expect, test, type Page } from "@playwright/test";

import {
  createHqMemberLink,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import { createVideoProcessorScenario } from "./fixtures/video-processor";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/** 1×1 PNG — OCR is stubbed; we only need a selectable image file. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PARSE_BODY = {
  banks: [
    {
      level: 2,
      crystalGoldValue: 600_000,
      gameServerNumber: 1211,
      coordX: 100,
      coordY: 200,
      currentDepositCount: 80,
    },
    {
      level: 3,
      crystalGoldValue: 486_000,
      gameServerNumber: 1211,
      coordX: 150,
      coordY: 250,
      currentDepositCount: 50,
    },
  ],
  snapshot: {
    capturedCount: 2,
    capturedLimit: 8,
    capturesRemainingToday: 2,
    capturesLimitToday: 2,
    serverTime: "2026-07-11T16:57:24.000Z",
    isComplete: true,
  },
};

const UNDERCOUNT_PARSE_BODY = {
  banks: PARSE_BODY.banks,
  snapshot: {
    ...PARSE_BODY.snapshot,
    // Header says 3 banks were captured, but OCR only recovered 2 tiles —
    // review shows incomplete warning only (no auto-padded placeholder rows).
    capturedCount: 3,
    isComplete: false,
  },
};

async function openCityListReview(
  page: Page,
  parseBody: unknown = PARSE_BODY,
): Promise<void> {
  await page.route("**/api/banks/city-list/parse", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(parseBody),
    });
  });

  await page.goto("/bank-management");
  await expect(
    page.getByRole("heading", { name: /bank management/i }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: /import banks from screenshot/i })
    .click();
  await expect(
    page.getByRole("heading", { name: /import banks from screenshots/i }),
  ).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "city-list.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(page.getByText(/1 screenshot selected/i)).toBeVisible();

  await page.getByRole("button", { name: /read screenshots/i }).click();
  await expect(page).toHaveURL(/\/bank-management\/import-review/, {
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading", { name: /review imported banks/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import banks", exact: true }),
  ).toBeVisible();
}

test.describe("City List import review (dedicated page)", () => {
  test("shows a 3-col card grid with K amounts and docked screenshot preview pane", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await createHqMemberLink(sql, {
      allianceId: scenario.allianceId,
      hqUserId: scenario.officer.hqUserId,
    });
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.setViewportSize({ width: 1280, height: 800 });

    await openCityListReview(page);

    const cards = page.getByTestId("city-list-review-card");
    await expect(cards).toHaveCount(2);
    await expect(page.locator("table")).toHaveCount(0);

    await expect(
      cards.first().getByRole("textbox", { name: /amount \(k\)/i }),
    ).toHaveValue("600.00K");

    // Desktop auto-opens the side preview pane when screenshots exist.
    const closePreview = page.getByRole("button", { name: /close preview/i });
    await expect(closePreview).toBeVisible({ timeout: 10_000 });

    await closePreview.click();
    await expect(closePreview).toBeHidden();

    // Toggle reopens the docked preview without leaving the review page.
    // Two controls share the label when closed (header + FAB) — either opens preview.
    await page
      .getByRole("button", { name: /preview screenshots/i })
      .first()
      .click();
    await expect(closePreview).toBeVisible();
    await closePreview.click();
    await expect(closePreview).toBeHidden();
    await expect(page).toHaveURL(/\/bank-management\/import-review/);
    await expect(
      page.getByRole("heading", { name: /review imported banks/i }),
    ).toBeVisible();
    await expect(cards).toHaveCount(2);
  });

  test("shows an incomplete warning without auto-inserting placeholder rows when OCR undercounts capturedCount", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await createHqMemberLink(sql, {
      allianceId: scenario.allianceId,
      hqUserId: scenario.officer.hqUserId,
    });
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.setViewportSize({ width: 390, height: 844 });

    await openCityListReview(page, UNDERCOUNT_PARSE_BODY);

    const cards = page.getByTestId("city-list-review-card");
    await expect(cards).toHaveCount(2);
    await expect(
      page.locator('[data-testid="city-list-review-card"][data-placeholder="true"]'),
    ).toHaveCount(0);
    await expect(
      page.getByText(/imported banks are fewer than the captured count/i),
    ).toBeVisible();
  });

  test("re-import hides archive-missing warning when extra HQ banks are already archived", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await createHqMemberLink(sql, {
      allianceId: scenario.allianceId,
      hqUserId: scenario.officer.hqUserId,
    });

    const now = new Date();
    const pastDrop = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO banks (
        id, alliance_id, game_server_number, coord_x, coord_y, level,
        prior_capture_count, drop_by_at, created_at, updated_at
      ) VALUES
        (
          ${`bank_${Date.now()}_match_a`},
          ${scenario.allianceId},
          ${1211},
          ${100},
          ${200},
          ${2},
          ${0},
          ${null},
          ${now},
          ${now}
        ),
        (
          ${`bank_${Date.now()}_match_b`},
          ${scenario.allianceId},
          ${1211},
          ${150},
          ${250},
          ${3},
          ${0},
          ${null},
          ${now},
          ${now}
        ),
        (
          ${`bank_${Date.now()}_archived`},
          ${scenario.allianceId},
          ${1211},
          ${300},
          ${400},
          ${2},
          ${0},
          ${pastDrop},
          ${now},
          ${now}
        )
    `;

    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.setViewportSize({ width: 1280, height: 800 });

    await openCityListReview(page);

    await expect(
      page.getByText(/banks already exist in HQ/i),
    ).toBeVisible();
    await expect(page.getByTestId("city-list-review-card")).toHaveCount(0);
    await expect(
      page.getByText(/Archive .* bank.* not in this import/i),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /show matched banks/i }).click();
    await expect(page.getByTestId("city-list-review-card")).toHaveCount(2);
  });

  test("keeps a 3-column card grid on narrow mobile viewports", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await createHqMemberLink(sql, {
      allianceId: scenario.allianceId,
      hqUserId: scenario.officer.hqUserId,
    });
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.setViewportSize({ width: 390, height: 844 });

    await openCityListReview(page);

    const cards = page.getByTestId("city-list-review-card");
    await expect(cards).toHaveCount(2);
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(second.x).toBeGreaterThan(first.x);
    expect(Math.abs(second.y - first.y)).toBeLessThan(40);
  });
});

test.describe("City List import review (draft restore)", () => {
  test("restores edited review via Continue and Reset clears sessionStorage", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await createHqMemberLink(sql, {
      allianceId: scenario.allianceId,
      hqUserId: scenario.officer.hqUserId,
    });
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.setViewportSize({ width: 1280, height: 800 });

    const draftKey = `alliance-hq.city-list-import-draft:${scenario.allianceId}`;

    await openCityListReview(page);

    const firstCard = page.getByTestId("city-list-review-card").first();
    const xInput = firstCard.getByRole("spinbutton", { name: /^x$/i });
    await xInput.fill("777");
    await expect
      .poll(async () =>
        page.evaluate((key) => window.sessionStorage.getItem(key), draftKey),
      )
      .not.toBeNull();

    await page.getByRole("button", { name: /^cancel$/i }).click();
    await expect(page).toHaveURL(/\/bank-management\/?$/);

    await page
      .getByRole("button", { name: /import banks from screenshot/i })
      .click();
    await expect(
      page.getByText(/Restored your unsaved review from last time/i),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /review imported banks/i })
      .click();
    await expect(page).toHaveURL(/\/bank-management\/import-review/);
    await expect(
      page
        .getByTestId("city-list-review-card")
        .first()
        .getByRole("spinbutton", { name: /^x$/i }),
    ).toHaveValue("777");

    await page.getByRole("button", { name: /^reset$/i }).click();
    await page.getByTestId("city-list-import-reset-confirm").click();

    await expect(page).toHaveURL(/\/bank-management\/?$/);
    await expect
      .poll(async () =>
        page.evaluate((key) => window.sessionStorage.getItem(key), draftKey),
      )
      .toBeNull();
  });
});

test.describe("Bank Management coord search", () => {
  test("filters banks by X/Y query across the list", async ({ page }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await createHqMemberLink(sql, {
      allianceId: scenario.allianceId,
      hqUserId: scenario.officer.hqUserId,
    });

    const now = new Date();
    await sql`
      INSERT INTO banks (
        id, alliance_id, game_server_number, coord_x, coord_y, level,
        prior_capture_count, created_at, updated_at
      ) VALUES
        (
          ${`bank_${Date.now()}_a`},
          ${scenario.allianceId},
          ${1211},
          ${100},
          ${200},
          ${2},
          ${0},
          ${now},
          ${now}
        ),
        (
          ${`bank_${Date.now()}_b`},
          ${scenario.allianceId},
          ${1211},
          ${150},
          ${250},
          ${3},
          ${0},
          ${now},
          ${now}
        )
    `;

    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto("/bank-management");
    await expect(
      page.getByRole("heading", { name: /bank management/i }),
    ).toBeVisible();

    const search = page.getByTestId("bank-coord-search");
    await expect(search).toBeVisible();
    await search.fill("100 200");
    await expect(
      page.getByRole("button", { name: /#1211 \(X:100, Y:200\)/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /#1211 \(X:150, Y:250\)/i }),
    ).toBeHidden();

    await search.fill("999 999");
    await expect(
      page.getByText(/No banks match those coordinates/i),
    ).toBeVisible();
  });
});
