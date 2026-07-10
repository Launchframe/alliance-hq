import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import { getServerCalendarDate } from "../src/lib/trains/game-time";
import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import { createViewOnlyMember } from "./fixtures/view-only-member";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

function scheduledAtOnServerDate(serverDate: string, hour = 14): string {
  return `${serverDate}T${String(hour).padStart(2, "0")}:00:00.000-02:00`;
}

async function createBattlePlanOfficer(sql: ReturnType<typeof getE2eSql>) {
  const alliance = await createNativeAlliance(sql, {
    tag: `BP${nanoid(4)}`,
    name: "Battle Plan E2E Alliance",
  });
  const auth = await createAuthenticatedHqSession(sql, uniqueEmail("bp-officer"));
  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "officer",
    source: "manual",
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId}
    WHERE id = ${auth.sessionId}
  `;
  return { alliance, auth };
}

test.describe("Battle plan — read access", () => {
  test("member loads /battle-plan without write controls", async ({ page }) => {
    const sql = getE2eSql();
    const member = await createViewOnlyMember(sql, e2eBaseUrl(), {
      operatingMode: "native",
    });
    await page.context().addCookies(playwrightAuthCookies(member));

    await page.goto("/battle-plan");
    await expect(page.getByRole("heading", { name: /battle plan/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /schedule capture/i }),
    ).toHaveCount(0);
  });
});

test.describe("Battle plan — officer scheduling", () => {
  test("rejects a third stronghold capture on the same server day", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, auth } = await createBattlePlanOfficer(sql);
    const cookie = authCookieHeader({
      sessionId: auth.sessionId,
      nextAuthToken: auth.nextAuthToken,
    });

    const bootstrap = await request.get("/api/battle-plan", {
      headers: { Cookie: cookie },
    });
    expect(bootstrap.status(), await bootstrap.text()).toBe(200);
    const bootstrapBody = (await bootstrap.json()) as {
      settings: { planRevision: number };
    };

    const serverDate = getServerCalendarDate();
    let planRevision = bootstrapBody.settings.planRevision;

    for (const markerNumber of [1, 2] as const) {
      const response = await request.post("/api/battle-plan/events", {
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        data: {
          scheduledAt: scheduledAtOnServerDate(serverDate, 10 + markerNumber),
          territoryType: "stronghold",
          markerNumber,
          planRevision,
        },
      });
      expect(response.status(), await response.text()).toBe(200);
      const body = (await response.json()) as {
        dashboard: { settings: { planRevision: number } };
      };
      planRevision = body.dashboard.settings.planRevision;
    }

    const third = await request.post("/api/battle-plan/events", {
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      data: {
        scheduledAt: scheduledAtOnServerDate(serverDate, 15),
        territoryType: "stronghold",
        markerNumber: 3,
        planRevision,
      },
    });
    expect(third.status()).toBe(400);
    const thirdBody = (await third.json()) as { error?: string };
    expect(thirdBody.error).toMatch(/already has 2 scheduled stronghold captures/i);

    const events = await sql<{ id: string }[]>`
      SELECT id
      FROM battle_plan_capture_events
      WHERE alliance_id = ${alliance.allianceId}
        AND server_calendar_date = ${serverDate}
        AND territory_type = 'stronghold'
        AND status = 'scheduled'
    `;
    expect(events).toHaveLength(2);
  });

  test("forbids member mutations", async ({ request }) => {
    const sql = getE2eSql();
    const member = await createViewOnlyMember(sql, e2eBaseUrl(), {
      operatingMode: "native",
    });
    const cookie = authCookieHeader(member);

    const bootstrap = await request.get("/api/battle-plan", {
      headers: { Cookie: cookie },
    });
    expect(bootstrap.status()).toBe(200);
    const bootstrapBody = (await bootstrap.json()) as {
      settings: { planRevision: number };
    };

    const response = await request.post("/api/battle-plan/events", {
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      data: {
        scheduledAt: scheduledAtOnServerDate(getServerCalendarDate()),
        territoryType: "stronghold",
        markerNumber: 1,
        planRevision: bootstrapBody.settings.planRevision,
      },
    });
    expect(response.status()).toBe(403);
  });
});
