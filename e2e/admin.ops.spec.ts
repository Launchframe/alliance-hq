import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";

import {
  authCookieHeader,
  createAuthenticatedHqSession,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

test.describe("Admin observability", () => {
  test("maintainer can load ops APIs and page; non-maintainer is forbidden", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const member = await createAuthenticatedHqSession(
      sql,
      `member-${nanoid(8)}@e2e.test`,
    );

    const eventId = nanoid();
    const runId = nanoid();
    await sql`
      insert into ops_events (
        id, severity, source, title, body, fingerprint, created_at
      ) values (
        ${eventId},
        'error',
        'e2e',
        'Seeded ops event',
        'seed body',
        ${`e2e:${eventId}`},
        now()
      )
    `;
    await sql`
      insert into cron_runs (
        id, name, started_at, finished_at, status, processed, duration_ms
      ) values (
        ${runId},
        'e2e-cron',
        now(),
        now(),
        'success',
        1,
        12
      )
    `;

    const memberCookie = authCookieHeader(member);
    const denied = await request.get("/api/admin/ops/summary", {
      headers: { Cookie: memberCookie },
    });
    expect(denied.status()).toBe(403);

    const maintainerCookie = authCookieHeader(maintainer);
    const summary = await request.get("/api/admin/ops/summary", {
      headers: { Cookie: maintainerCookie },
    });
    expect(summary.status(), await summary.text()).toBe(200);
    const summaryBody = (await summary.json()) as {
      latestCronRuns?: Array<{ name?: string }>;
      recentFailures?: Array<{ id?: string }>;
    };
    expect(
      summaryBody.latestCronRuns?.some((run) => run.name === "e2e-cron"),
    ).toBe(true);

    const events = await request.get("/api/admin/ops/events", {
      headers: { Cookie: maintainerCookie },
    });
    expect(events.status()).toBe(200);
    const eventRows = (await events.json()) as Array<{ id: string }>;
    expect(eventRows.some((row) => row.id === eventId)).toBe(true);

    await page.context().addCookies(playwrightAuthCookies(maintainer));
    await page.goto("/en-US/admin/ops");
    await expect(page.getByRole("heading", { name: "Observability" })).toBeVisible();
    await expect(page.getByText("Seeded ops event")).toBeVisible();
  });
});
