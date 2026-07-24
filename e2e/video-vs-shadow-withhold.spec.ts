import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import {
  createVideoProcessorScenario,
  createVsShadowWithholdFixture,
  seedRosterMemberBatch,
  setVideoJobStatus,
} from "./fixtures/video-processor";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

test.describe("VS early shadow withhold review", () => {
  test("withholds thin primary review while shadow is in flight, opens when shadow completes", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createVideoProcessorScenario(sql, e2eBaseUrl());
    await seedRosterMemberBatch(sql, {
      allianceId: scenario.allianceId,
      count: 29,
    });

    const fixture = await createVsShadowWithholdFixture(sql, {
      allianceId: scenario.allianceId,
      sessionId: scenario.officer.sessionId,
      enqueuedByHqUserId: scenario.officer.hqUserId,
    });

    const cookie = authCookieHeader(scenario.officer);
    const jobRes = await request.get(
      `/api/tools/video-upload/${fixture.primaryJobId}`,
      { headers: { Cookie: cookie } },
    );
    expect(jobRes.status(), await jobRes.text()).toBe(200);
    const jobBody = (await jobRes.json()) as {
      shadowPassInFlight?: boolean;
      expectedRowCount?: number | null;
    };
    expect(jobBody.shadowPassInFlight).toBe(true);
    expect(jobBody.expectedRowCount).toBeGreaterThan(5);

    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto(`/tools/video-upload/${fixture.primaryJobId}/review`);

    await expect(
      page.getByText(/gathering denser leaderboard frames/i),
    ).toBeVisible();

    await setVideoJobStatus(sql, fixture.shadowJobId, "review");

    await expect(
      page.getByRole("heading", { name: /review extracted data/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
