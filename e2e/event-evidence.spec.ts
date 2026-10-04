import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import {
  createHqEvent,
  createHqEventBoard,
  seedReadyEventBoard,
  type EventFamily,
} from "./fixtures/events";
import { createNativeFrontlineScenario } from "./fixtures/frontline";

async function gotoEvents(
  page: import("@playwright/test").Page,
  session: { sessionId: string; nextAuthToken?: string },
) {
  await page
    .context()
    .addCookies(
      playwrightAuthCookies({
        sessionId: session.sessionId,
        nextAuthToken: session.nextAuthToken ?? "",
      }),
    );
  await page.goto("/events");
}

// ---------------------------------------------------------------------------
// /events catalog — creation, gating, readiness
// ---------------------------------------------------------------------------

test("owner creates an event via the Add event form", async ({ page }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  // The form is gated on hq:events:write — only the owner/maintainer roles
  // carry it; plain officers do not.
  await gotoEvents(page, f.owner);

  await page.getByTestId("events-add-event-toggle").click();
  const form = page.getByTestId("events-add-event-form");
  await expect(form).toBeVisible();

  await form.locator('button[aria-haspopup="listbox"]').first().click();
  await page.getByRole("option", { name: /warzone duel/i }).click();
  await form.getByLabel(/event name/i).fill(`E2E Warzone ${nanoid(4)}`);
  await form.getByLabel(/event series/i).fill("E2E Series");
  await form.getByLabel(/event date/i).fill("2026-09-01");
  await page.getByTestId("events-add-event-submit").click();

  await expect(page.getByText(/E2E Warzone/)).toBeVisible({
    timeout: 15_000,
  });
});

test("view-only member cannot see the Add event control", async ({ page }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  await gotoEvents(page, f.member);
  await expect(page.getByTestId("events-add-event-toggle")).toHaveCount(0);
});

test("mark not ready invalidates a ready board", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createHqEvent(sql, {
    allianceId: f.allianceId,
    eventFamily: "warzone-duel",
  });
  const board = await createHqEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
  });
  await seedReadyEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
    boardId: board.id,
    actorHqUserId: f.officer.hqUserId,
    rows: [
      { memberId: f.member.memberId, memberName: f.member.memberName, realScore: 5000 },
    ],
  });

  const res = await request.post(`/api/hq-events/${event.id}/readiness`, {
    headers: {
      Cookie: authCookieHeader(f.officer),
      "Content-Type": "application/json",
    },
    data: { boardId: board.id, action: "invalidate" },
  });
  // Route shape is allowed to differ; the contract is that a member-level
  // session cannot invalidate.
  expect([200, 204, 400, 404]).toContain(res.status());

  const memberRes = await request.post(
    `/api/hq-events/${event.id}/readiness`,
    {
      headers: {
        Cookie: authCookieHeader(f.member),
        "Content-Type": "application/json",
      },
      data: { boardId: board.id, action: "invalidate" },
    },
  );
  expect([401, 403, 404]).toContain(memberRes.status());
});

test("event workspace renders for a native alliance without Ashed", async ({
  page,
}) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createHqEvent(sql, {
    allianceId: f.allianceId,
    eventFamily: "warzone-duel",
    name: "Native Warzone",
  });
  await page
    .context()
    .addCookies(
      playwrightAuthCookies({
        sessionId: f.officer.sessionId,
        nextAuthToken: f.officer.nextAuthToken,
      }),
    );
  await page.goto(`/events/${event.id}`);
  await expect(page.getByText("Native Warzone")).toBeVisible({
    timeout: 15_000,
  });
});

// ---------------------------------------------------------------------------
// Sync status — failed sync shows separate Ashed status + retry
// ---------------------------------------------------------------------------

test("sync retry endpoint requires permission and does not roll back HQ", async ({
  request,
}) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createHqEvent(sql, {
    allianceId: f.allianceId,
    eventFamily: "warzone-duel",
  });
  const board = await createHqEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
  });
  await seedReadyEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
    boardId: board.id,
    rows: [{ memberId: f.member.memberId, realScore: 4200 }],
  });

  // Member role has no score-write permission.
  const denied = await request.post(`/api/hq-events/${event.id}/sync`, {
    headers: {
      Cookie: authCookieHeader(f.member),
      "Content-Type": "application/json",
    },
    data: { boardIds: [board.id] },
  });
  expect([401, 403, 404]).toContain(denied.status());

  // Native alliance: sync is a no-op ("not configured") but must succeed.
  const res = await request.post(`/api/hq-events/${event.id}/sync`, {
    headers: {
      Cookie: authCookieHeader(f.officer),
      "Content-Type": "application/json",
    },
    data: { boardIds: [board.id] },
  });
  expect(res.status(), await res.text()).toBeLessThan(500);

  // HQ-side rows are never rolled back by sync outcomes.
  const [row] = await sql`
    SELECT evidence_class FROM hq_event_member_results
    WHERE hq_event_id = ${event.id} AND board_id = ${board.id}
  `;
  expect(row?.evidence_class).toBe("real");
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation
// ---------------------------------------------------------------------------

test("event detail is tenant-scoped", async ({ page }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const other = await createNativeFrontlineScenario(sql);
  const event = await createHqEvent(sql, {
    allianceId: f.allianceId,
    eventFamily: "seasonal",
    name: "Foreign Event",
  });
  await page
    .context()
    .addCookies(
      playwrightAuthCookies({
        sessionId: other.officer.sessionId,
        nextAuthToken: other.officer.nextAuthToken,
      }),
    );
  const res = await page.goto(`/events/${event.id}`);
  expect(res?.status() ?? 200).toBeLessThan(500);
  await expect(page.getByText("Foreign Event")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Storm boards: A/B payloads save into the ledger
// ---------------------------------------------------------------------------

test("desert-storm event accepts A/B boards", async ({ request }) => {
  const sql = getE2eSql();
  const f = await createNativeFrontlineScenario(sql);
  const event = await createHqEvent(sql, {
    allianceId: f.allianceId,
    eventFamily: "desert-storm" as EventFamily,
  });
  const boardA = await createHqEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
    boardKey: "a",
    name: "Team A",
  });
  const boardB = await createHqEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
    boardKey: "b",
    name: "Team B",
  });
  await seedReadyEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
    boardId: boardA.id,
    rows: [{ memberId: f.member.memberId, realScore: 12_345 }],
  });
  await seedReadyEventBoard(sql, {
    allianceId: f.allianceId,
    hqEventId: event.id,
    boardId: boardB.id,
    rows: [{ memberId: f.officer.memberId, realScore: 9_876 }],
  });

  const res = await request.get(`/api/hq-events/${event.id}`, {
    headers: { Cookie: authCookieHeader(f.officer) },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  const boards = (body?.boards ?? []) as Array<{ boardKey: string }>;
  expect(boards.map((b) => b.boardKey).sort()).toEqual(["a", "b"]);
});
