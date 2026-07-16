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
    // the modal should pad the review list with a blank placeholder row.
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
  await expect(
    page.getByRole("button", { name: "Import banks", exact: true }),
  ).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("City List import review (responsive)", () => {
  test("mobile card stepper advances banks and opens screenshot lightbox", async ({
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

    await expect(page.getByText(/New Bank 1 of 2/i)).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeVisible();
    // Desktop table stays in the DOM with `hidden md:block`.
    await expect(page.locator("table")).toBeHidden();

    await page.getByRole("button", { name: /^next$/i }).click();
    await expect(page.getByText(/New Bank 2 of 2/i)).toBeVisible();

    await page.getByRole("button", { name: /^previous$/i }).click();
    await expect(page.getByText(/New Bank 1 of 2/i)).toBeVisible();

    await page
      .getByRole("button", { name: /preview screenshots/i })
      .click();
    await expect(page.locator(".yarl__root")).toBeVisible({ timeout: 10_000 });
  });

  test("desktop shows table and left screenshot preview pane", async ({
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

    const reviewTable = page.locator("table");
    await expect(reviewTable).toBeVisible();
    await expect(reviewTable.getByText(/stronghold level/i)).toBeVisible();
    // Mobile stepper copy is `md:hidden`.
    await expect(page.getByText(/New Bank 1 of 2/i)).toBeHidden();
    await expect(page.getByRole("progressbar")).toBeHidden();

    await expect(
      page.getByRole("button", { name: /preview screenshot/i }).first(),
    ).toBeVisible();
  });
});

test.describe("City List import review (captured count padding)", () => {
  test("pads a blank row when OCR parses fewer tiles than the captured count", async ({
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

    // Header said 3 banks captured; OCR only returned 2 — a 3rd blank row
    // is padded in so the officer can fill it in manually.
    await expect(page.getByText(/New Bank 1 of 3/i)).toBeVisible();

    await page.getByRole("button", { name: /^next$/i }).click();
    await page.getByRole("button", { name: /^next$/i }).click();
    await expect(page.getByText(/New Bank 3 of 3/i)).toBeVisible();

    // Submitting without filling in the padded row's coordinates surfaces
    // validation errors instead of silently importing a (0, 0) bank.
    await page.getByRole("button", { name: "Import banks", exact: true }).click();
    await expect(page.getByText(/required/i).first()).toBeVisible();
  });
});
