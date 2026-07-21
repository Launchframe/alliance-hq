import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  addCalendarDays,
  getServerCalendarDate,
  isCalendarDateOnOrAfter,
} from "../src/lib/trains/game-time";
import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
  type SessionFixture,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

type TrainsScheduleFixture = {
  auth: SessionFixture;
  cookies: ReturnType<typeof playwrightAuthCookies>;
  cookieHeader: string;
  weekStart: string;
  today: string;
};

async function setupPersistedTrainsWeek(
  request: APIRequestContext,
  options?: {
    maintainer?: boolean;
  },
): Promise<TrainsScheduleFixture> {
  const sql = getE2eSql();
  const tag = `TR${nanoid(4)}`;
  const alliance = await createNativeAlliance(sql, {
    tag,
    name: "Week Strip Template Alliance",
  });
  const auth = options?.maintainer
    ? await createPlatformMaintainerSession(sql)
    : await createAuthenticatedHqSession(sql, uniqueEmail("week-strip-officer"));

  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "officer",
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: auth.hqUserId,
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Week Strip Roster Member",
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;

  const cookies = playwrightAuthCookies({
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
  });
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");

  const dashboardRes = await request.get("/api/trains/schedule", {
    headers: { Cookie: cookieHeader },
  });
  expect(dashboardRes.ok(), await dashboardRes.text()).toBeTruthy();
  const dashboard = (await dashboardRes.json()) as { weekStart: string };

  const createRes = await request.post("/api/trains/schedule", {
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    data: {
      weekStart: dashboard.weekStart,
      templateType: "vs_push_week",
    },
  });
  expect(createRes.ok(), await createRes.text()).toBeTruthy();

  return {
    auth,
    cookies,
    cookieHeader,
    weekStart: dashboard.weekStart,
    today: getServerCalendarDate(),
  };
}

async function openDayTemplateMenu(
  page: Page,
  date: string,
  position: { x: number; y: number } = { x: 12, y: 12 },
) {
  const day = page.getByTestId(`trains-week-day-${date}`);
  await expect(day).toBeVisible();
  await day.click({ button: "right", position });
  await expect(page.getByTestId("trains-day-template-menu")).toBeVisible();
}

async function readPaintTemplate(
  request: APIRequestContext,
  cookieHeader: string,
  weekStart: string,
  date: string,
): Promise<string | null> {
  const res = await request.get(
    `/api/trains/schedule/week?weekStart=${encodeURIComponent(weekStart)}`,
    { headers: { Cookie: cookieHeader } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  const payload = (await res.json()) as {
    dayConfigs: Array<{ date: string; paintTemplate: string | null }>;
  };
  return payload.dayConfigs.find((day) => day.date === date)?.paintTemplate ?? null;
}

test.describe("Week strip day template menu", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("trains_walkthrough_seen", "1");
    });
  });

  test("right-click opens menu, arrow keys move focus, Escape dismisses", async ({
    page,
    request,
  }) => {
    const fixture = await setupPersistedTrainsWeek(request);
    await page.context().addCookies(fixture.cookies);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/trains");
    await expect(page.getByTestId("trains-schedule-section")).toBeVisible({
      timeout: 15_000,
    });

    await openDayTemplateMenu(page, fixture.today);

    const economyItem = page.getByTestId("trains-day-template-economy_week");
    await economyItem.focus();
    await expect(economyItem).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("trains-day-template-r4_event_vip")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trains-day-template-menu")).toHaveCount(0);
    await expect(page.getByTestId(`trains-week-day-${fixture.today}`)).toBeFocused();
  });

  test("selecting a template paints the day", async ({ page, request }) => {
    const fixture = await setupPersistedTrainsWeek(request);
    await page.context().addCookies(fixture.cookies);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/trains");
    await expect(page.getByTestId("trains-schedule-section")).toBeVisible({
      timeout: 15_000,
    });

    const paintDate = isCalendarDateOnOrAfter(addCalendarDays(fixture.today, 1), fixture.weekStart)
      ? addCalendarDays(fixture.today, 1)
      : fixture.today;

    await openDayTemplateMenu(page, paintDate);
    await page.getByTestId("trains-day-template-economy_week").click();
    await expect(page.getByTestId("trains-day-template-menu")).toHaveCount(0);

    await expect
      .poll(async () =>
        readPaintTemplate(request, fixture.cookieHeader, fixture.weekStart, paintDate),
      )
      .toBe("economy_week");
  });

  test("menu stays within the viewport when opened near the bottom-right edge", async ({
    page,
  }) => {
    const fixture = await setupPersistedTrainsWeek(request);
    await page.context().addCookies(fixture.cookies);
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto("/trains");
    await expect(page.getByTestId("trains-schedule-section")).toBeVisible({
      timeout: 15_000,
    });

    const day = page.getByTestId(`trains-week-day-${fixture.today}`);
    const box = await day.boundingBox();
    expect(box).not.toBeNull();
    await openDayTemplateMenu(page, fixture.today, {
      x: Math.max(4, box!.width - 4),
      y: Math.max(4, box!.height - 4),
    });

    const menuBox = await page.getByTestId("trains-day-template-menu").boundingBox();
    expect(menuBox).not.toBeNull();
    const pad = 8;
    expect(menuBox!.x).toBeGreaterThanOrEqual(pad);
    expect(menuBox!.y).toBeGreaterThanOrEqual(pad);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(1280 - pad);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(480 - pad);
  });

  test("mobile carousel long-press opens the template menu", async ({ page }) => {
    const fixture = await setupPersistedTrainsWeek(request);
    await page.context().addCookies(fixture.cookies);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/trains");
    await expect(page.getByTestId("trains-schedule-section")).toBeVisible({
      timeout: 15_000,
    });

    const day = page.getByTestId(`trains-week-day-${fixture.today}`);
    const box = await day.boundingBox();
    expect(box).not.toBeNull();

    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.up();

    await expect(page.getByTestId("trains-day-template-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("trains-day-template-menu")).toHaveCount(0);
  });

  test("maintainer painting a past day shows confirm dialog", async ({
    page,
    request,
  }) => {
    const fixture = await setupPersistedTrainsWeek(request, { maintainer: true });
    const pastDate = addCalendarDays(fixture.today, -1);
    test.skip(
      !isCalendarDateOnOrAfter(pastDate, fixture.weekStart),
      "No past day in the current train week to paint.",
    );

    await page.context().addCookies(fixture.cookies);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/trains");
    await expect(page.getByTestId("trains-schedule-section")).toBeVisible({
      timeout: 15_000,
    });

    await openDayTemplateMenu(page, pastDate);
    await page.getByTestId("trains-day-template-economy_week").click();
    await expect(page.getByRole("dialog", { name: /paint past train days/i })).toBeVisible();
    await page.getByTestId("trains-past-paint-confirm").click();
    await expect(page.getByRole("dialog", { name: /paint past train days/i })).toHaveCount(0);

    await expect
      .poll(async () =>
        readPaintTemplate(request, fixture.cookieHeader, fixture.weekStart, pastDate),
      )
      .toBe("economy_week");
  });
});
