import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

async function createBattlePlanOfficer(sql: ReturnType<typeof getE2eSql>) {
  const alliance = await createNativeAlliance(sql, {
    tag: `CR${nanoid(4)}`,
    name: "Capture Reminder E2E Alliance",
  });
  const auth = await createAuthenticatedHqSession(sql, uniqueEmail("cr-officer"));
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

function pastScheduledAtIso(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

test.describe("Capture reminder inbox", () => {
  test("lists reminder after scheduled capture time and confirms with coords", async ({
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

    const createEvent = await request.post("/api/battle-plan/events", {
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      data: {
        scheduledAt: pastScheduledAtIso(),
        territoryType: "stronghold",
        iconPreset: "ordinal-1",
        capturePolicy: "peace",
        notes: "North gate",
        planRevision: bootstrapBody.settings.planRevision,
      },
    });
    expect(createEvent.status(), await createEvent.text()).toBe(200);
    const createBody = (await createEvent.json()) as {
      event: { id: string };
    };

    const inbox = await request.get("/api/inbox/reminders", {
      headers: { Cookie: cookie },
    });
    expect(inbox.status(), await inbox.text()).toBe(200);
    const inboxBody = (await inbox.json()) as {
      items: Array<{
        kind: string;
        resourceId: string | null;
        captureScheduledAt: string | null;
        captureHasCoords: boolean;
        scoreTarget: string | null;
      }>;
    };
    const reminder = inboxBody.items.find(
      (item) =>
        item.kind === "capture_reminder" &&
        item.resourceId === createBody.event.id,
    );
    expect(reminder).toBeTruthy();
    expect(reminder?.captureScheduledAt).toBeTruthy();
    expect(reminder?.captureHasCoords).toBe(false);
    expect(reminder?.scoreTarget).toBe("North gate");

    const missingCoords = await request.post(
      `/api/battle-plan/events/${createBody.event.id}/confirm-capture`,
      { headers: { Cookie: cookie } },
    );
    expect(missingCoords.status()).toBe(400);

    const confirm = await request.post(
      `/api/battle-plan/events/${createBody.event.id}/confirm-capture`,
      {
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        data: {
          gameServerNumber: 742,
          coordX: 100,
          coordY: 200,
          level: 5,
        },
      },
    );
    expect(confirm.status(), await confirm.text()).toBe(200);
    const confirmBody = (await confirm.json()) as {
      bank: { id: string; coordX: number; coordY: number; level: number };
    };
    expect(confirmBody.bank.coordX).toBe(100);
    expect(confirmBody.bank.coordY).toBe(200);
    expect(confirmBody.bank.level).toBe(5);

    const banks = await sql<{ id: string }[]>`
      SELECT id
      FROM banks
      WHERE alliance_id = ${alliance.allianceId}
        AND id = ${confirmBody.bank.id}
    `;
    expect(banks).toHaveLength(1);

    const inboxAfter = await request.get("/api/inbox/reminders", {
      headers: { Cookie: cookie },
    });
    const inboxAfterBody = (await inboxAfter.json()) as {
      items: Array<{ kind: string; resourceId: string | null }>;
    };
    expect(
      inboxAfterBody.items.some(
        (item) =>
          item.kind === "capture_reminder" &&
          item.resourceId === createBody.event.id,
      ),
    ).toBe(false);
  });

  test("officer can dismiss capture reminder from inbox UI", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const { auth } = await createBattlePlanOfficer(sql);
    const cookie = authCookieHeader({
      sessionId: auth.sessionId,
      nextAuthToken: auth.nextAuthToken,
    });
    await page.context().addCookies(playwrightAuthCookies(auth));

    const bootstrap = await request.get("/api/battle-plan", {
      headers: { Cookie: cookie },
    });
    const bootstrapBody = (await bootstrap.json()) as {
      settings: { planRevision: number };
    };

    const createEvent = await request.post("/api/battle-plan/events", {
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      data: {
        scheduledAt: pastScheduledAtIso(),
        territoryType: "stronghold",
        iconPreset: "ordinal-2",
        capturePolicy: "peace",
        planRevision: bootstrapBody.settings.planRevision,
      },
    });
    expect(createEvent.status()).toBe(200);

    await page.goto("/inbox");
    await expect(
      page.getByText(/was this stronghold successfully captured/i),
    ).toBeVisible();
    await expect(page.getByText(/scheduled capture/i)).toBeVisible();
    await page.getByRole("button", { name: /^no$/i }).click();

    await expect(
      page.getByText(/was this stronghold successfully captured/i),
    ).toHaveCount(0);
  });
});
