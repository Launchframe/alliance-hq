import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import { addCalendarDays } from "../src/lib/trains/game-time";
import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

type OfficerFixture = {
  cookieHeader: string;
  cookies: ReturnType<typeof playwrightAuthCookies>;
  today: string;
  memberA: { ashedMemberId: string; name: string };
  memberB: { ashedMemberId: string; name: string };
};

async function setupHistoryImportOfficer(
  request: APIRequestContext,
): Promise<OfficerFixture> {
  const sql = getE2eSql();
  const tag = `TR${nanoid(4)}`;
  const alliance = await createNativeAlliance(sql, {
    tag,
    name: "Conductor History Import Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail("hist-import-officer"),
  );
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

  const memberAName = "HistImport Alpha";
  const memberBName = "HistImport Beta";
  const memberA = await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: memberAName,
  });
  const memberB = await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: memberBName,
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
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  const scheduleRes = await request.get("/api/trains/schedule", {
    headers: { Cookie: cookieHeader },
  });
  expect(scheduleRes.ok(), await scheduleRes.text()).toBeTruthy();
  const schedule = (await scheduleRes.json()) as { today: string; weekStart: string };

  const createWeekRes = await request.post("/api/trains/schedule", {
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    data: {
      weekStart: schedule.weekStart,
      templateType: "vs_push_week",
    },
  });
  expect(createWeekRes.ok(), await createWeekRes.text()).toBeTruthy();

  return {
    cookieHeader,
    cookies,
    today: schedule.today,
    memberA: { ashedMemberId: memberA.ashedMemberId, name: memberAName },
    memberB: { ashedMemberId: memberB.ashedMemberId, name: memberBName },
  };
}

async function pickAndLockConductor(
  request: APIRequestContext,
  cookieHeader: string,
  input: { date: string; memberId: string; memberName: string },
) {
  const pickRes = await request.post("/api/trains/conductor/pick", {
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    data: {
      date: input.date,
      memberId: input.memberId,
      memberName: input.memberName,
    },
  });
  expect(pickRes.ok(), await pickRes.text()).toBeTruthy();

  const lockRes = await request.post("/api/trains/conductor/lock", {
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    data: { date: input.date },
  });
  expect(lockRes.ok(), await lockRes.text()).toBeTruthy();
}

test.describe("Conductor history import", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("trains_walkthrough_seen", "1");
    });
  });

  test("officer imports two past days from paste review", async ({
    page,
    request,
  }) => {
    const fixture = await setupHistoryImportOfficer(request);
    const newest = addCalendarDays(fixture.today, -2);
    const oldest = addCalendarDays(fixture.today, -3);
    test.skip(
      oldest >= fixture.today,
      "Need at least two past calendar days for import.",
    );

    await page.context().addCookies(fixture.cookies);
    await page.goto("/trains");
    await page.getByTestId("trains-history-import-open").scrollIntoViewIfNeeded();
    await page.getByTestId("trains-history-import-open").click();
    await expect(page).toHaveURL(/\/trains\/history-import/);

    await page.getByTestId("trains-history-import-paste").fill(
      `${fixture.memberA.name}\n${fixture.memberB.name}`,
    );
    await page.locator('input[type="date"]').nth(0).fill(newest);
    await page.locator('input[type="date"]').nth(1).fill(oldest);
    await page.getByTestId("trains-history-import-review").click();

    await expect(page.getByTestId("trains-history-import-row-0")).toHaveAttribute(
      "data-status",
      "ready",
    );
    await expect(page.getByTestId("trains-history-import-row-1")).toHaveAttribute(
      "data-status",
      "ready",
    );
    await page.getByTestId("trains-history-import-commit").click();
    await expect(page.getByTestId("trains-history-import-paste")).toHaveCount(0);

    await expect
      .poll(async () => {
        const res = await request.get(
          `/api/trains/conductor/history-import?start=${encodeURIComponent(oldest)}&end=${encodeURIComponent(newest)}`,
          { headers: { Cookie: fixture.cookieHeader } },
        );
        if (!res.ok()) return null;
        const body = (await res.json()) as {
          records: Array<{ date: string; lockedAt: string | null; conductorMemberId: string | null }>;
        };
        const byDate = new Map(body.records.map((r) => [r.date, r]));
        return (
          byDate.get(newest)?.lockedAt &&
          byDate.get(newest)?.conductorMemberId === fixture.memberA.ashedMemberId &&
          byDate.get(oldest)?.lockedAt &&
          byDate.get(oldest)?.conductorMemberId === fixture.memberB.ashedMemberId
        );
      })
      .toBeTruthy();
  });

  test("locked different conductor shows conflict and skips commit", async ({
    page,
    request,
  }) => {
    const fixture = await setupHistoryImportOfficer(request);
    const targetDate = addCalendarDays(fixture.today, -2);
    test.skip(
      targetDate >= fixture.today,
      "Need a past calendar day for conflict import.",
    );

    await pickAndLockConductor(request, fixture.cookieHeader, {
      date: targetDate,
      memberId: fixture.memberA.ashedMemberId,
      memberName: fixture.memberA.name,
    });

    await page.context().addCookies(fixture.cookies);
    await page.goto("/trains");
    await page.getByTestId("trains-history-import-open").click();
    await expect(page).toHaveURL(/\/trains\/history-import/);
    await page.getByTestId("trains-history-import-paste").fill(fixture.memberB.name);
    await page.locator('input[type="date"]').nth(0).fill(targetDate);
    await page.locator('input[type="date"]').nth(1).fill(targetDate);
    await page.getByTestId("trains-history-import-review").click();

    await expect(page.getByTestId("trains-history-import-row-0")).toHaveAttribute(
      "data-status",
      "conflict_locked",
    );
    await expect(page.getByTestId("trains-history-import-commit")).toBeDisabled();

    const importRes = await request.post("/api/trains/conductor/history-import", {
      headers: {
        Cookie: fixture.cookieHeader,
        "Content-Type": "application/json",
      },
      data: {
        rows: [
          {
            date: targetDate,
            memberId: fixture.memberB.ashedMemberId,
            memberName: fixture.memberB.name,
          },
        ],
      },
    });
    expect(importRes.ok()).toBeTruthy();
    const body = (await importRes.json()) as { conflicts: number; imported: number };
    expect(body.conflicts).toBe(1);
    expect(body.imported).toBe(0);
  });

  test("imports a former roster member and keeps denormalized name after churn", async ({
    page,
    request,
  }) => {
    const fixture = await setupHistoryImportOfficer(request);
    const targetDate = addCalendarDays(fixture.today, -2);
    test.skip(
      targetDate >= fixture.today,
      "Need a past calendar day for former import.",
    );

    const sql = getE2eSql();
    await sql`
      UPDATE alliance_members
      SET status = 'former'
      WHERE ashed_member_id = ${fixture.memberB.ashedMemberId}
    `;

    await page.context().addCookies(fixture.cookies);
    await page.goto("/trains/history-import");
    await page.getByTestId("trains-history-import-paste").fill(
      `${fixture.memberA.name}\n${fixture.memberB.name}`,
    );
    const newest = addCalendarDays(fixture.today, -2);
    const oldest = addCalendarDays(fixture.today, -3);
    await page.locator('input[type="date"]').nth(0).fill(newest);
    await page.locator('input[type="date"]').nth(1).fill(oldest);
    await page.getByTestId("trains-history-import-review").click();

    await expect(page.getByTestId("trains-history-import-row-0")).toHaveAttribute(
      "data-status",
      "ready",
    );
    await expect(page.getByTestId("trains-history-import-row-1")).toHaveAttribute(
      "data-status",
      "inactive_member",
    );
    await page.getByTestId("trains-history-import-commit").click();

    await expect
      .poll(async () => {
        const res = await request.get(
          `/api/trains/conductor/history-import?start=${encodeURIComponent(oldest)}&end=${encodeURIComponent(newest)}`,
          { headers: { Cookie: fixture.cookieHeader } },
        );
        if (!res.ok()) return null;
        const body = (await res.json()) as {
          records: Array<{
            date: string;
            lockedAt: string | null;
            conductorMemberId: string | null;
            conductorMemberName: string | null;
          }>;
        };
        const byDate = new Map(body.records.map((r) => [r.date, r]));
        const formerDay = byDate.get(oldest);
        return (
          Boolean(formerDay?.lockedAt) &&
          formerDay?.conductorMemberId === fixture.memberB.ashedMemberId &&
          formerDay?.conductorMemberName === fixture.memberB.name
        );
      })
      .toBeTruthy();
  });
});
