import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  addCalendarDays,
  getServerCalendarDate,
  getWeekStartMonday,
} from "../src/lib/trains/game-time";
import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import { createNativeVsScenario } from "./fixtures/vs-evidence";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

async function setupVsAlliance(
  request: APIRequestContext,
  roleName: "officer" | "viewer" | "member",
) {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `VS${nanoid(4)}`,
    name: "VS Weekly Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail(`vs-${roleName}`),
  );
  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: alliance.allianceId,
    roleName,
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: auth.hqUserId,
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "VS Roster Member",
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;
  const cookieHeader = playwrightAuthCookies({
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
  })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  return { alliance, auth, cookieHeader };
}

type VsWeekPayload = {
  weekStart: string;
  today: string;
  scope: string;
  contextScope: string;
  canEdit: boolean;
  matchup: {
    id: string;
    version: number;
    opponentName: string | null;
    opponentTag: string | null;
    days: Array<{ recordedDate: string; outcome: string; version: number }>;
    conflicts: unknown[];
  } | null;
  points: { alliancePoints: number; opponentPoints: number };
  canImportAshed: boolean;
  leadDays: number;
  days: Array<{ scoreDate: string; trainDate: string }>;
};

test.describe("VS weekly planner API", () => {
  test("officer creates matchup, records a final result, points recompute", async ({
    request,
  }) => {
    const { cookieHeader } = await setupVsAlliance(request, "officer");

    const weekRes = await request.get("/api/vs-performance/week", {
      headers: { Cookie: cookieHeader },
    });
    expect(weekRes.ok(), await weekRes.text()).toBeTruthy();
    const week = (await weekRes.json()) as VsWeekPayload;
    expect(typeof week.scope).toBe("string");
    expect(week.scope.length).toBeGreaterThan(0);
    expect(week.canEdit).toBe(true);
    expect(week.days).toHaveLength(6);
    expect(week.canImportAshed).toBe(false);

    const pastWeek = getWeekStartMonday(addCalendarDays(week.weekStart, -7));
    const pastRes = await request.get(
      `/api/vs-performance/week?weekStart=${pastWeek}`,
      { headers: { Cookie: cookieHeader } },
    );
    expect(pastRes.ok(), await pastRes.text()).toBeTruthy();
    const pastWeekPayload = (await pastRes.json()) as VsWeekPayload;
    const completedDate = pastWeekPayload.days[0]!.scoreDate;
    expect(completedDate < pastWeekPayload.today).toBeTruthy();
    week.weekStart = pastWeek;
    week.scope = pastWeekPayload.scope;

    const matchupRes = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: week.weekStart,
        opponentName: "Foe Alliance",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    expect(matchupRes.ok(), await matchupRes.text()).toBeTruthy();
    const matchup = (await matchupRes.json()) as NonNullable<
      VsWeekPayload["matchup"]
    >;
    expect(matchup.opponentName).toBe("Foe Alliance");

    const dayRes = await request.patch(
      `/api/vs-performance/matchup/days/${completedDate}`,
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          matchupId: matchup.id,
          expectedVersion: 0,
          requestId: `e2e-${nanoid(12)}`,
          totals: { ourScore: "10000000", opponentScore: "9000000" },
          reportedOutcome: null,
          finality: "final",
          scope: week.scope,
        },
      },
    );
    expect(dayRes.ok(), await dayRes.text()).toBeTruthy();
    const saved = (await dayRes.json()) as { outcome: string };
    expect(saved.outcome).toBe("won");

    const refreshed = (await (
      await request.get(
        `/api/vs-performance/week?weekStart=${pastWeek}`,
        { headers: { Cookie: cookieHeader } },
      )
    ).json()) as VsWeekPayload;
    expect(refreshed.points.alliancePoints).toBeGreaterThan(0);
    expect(refreshed.matchup?.days.length).toBe(1);
  });

  test("non-officer can read but cannot mutate", async ({ request }) => {
    const { cookieHeader } = await setupVsAlliance(request, "viewer");

    const weekRes = await request.get("/api/vs-performance/week", {
      headers: { Cookie: cookieHeader },
    });
    expect(weekRes.status()).toBe(200);
    const week = (await weekRes.json()) as VsWeekPayload;
    expect(week.canEdit).toBe(false);

    const denied = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: week.weekStart,
        opponentName: "X",
        opponentTag: "X",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    expect(denied.status()).toBe(403);
  });

  test("anonymous requests are rejected", async ({ request }) => {
    const res = await request.get("/api/vs-performance/week");
    expect([401, 403]).toContain(res.status());
  });

  test("Ashed pull is rejected for a native-only alliance", async ({
    request,
  }) => {
    const { cookieHeader } = await setupVsAlliance(request, "officer");
    const week = (await (
      await request.get("/api/vs-performance/week", {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    expect(week.canImportAshed).toBe(false);
    const res = await request.post("/api/vs-performance/matchup/import", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: { weekStart: week.weekStart, scope: week.scope },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("ashed_unavailable");
  });

  test("native page loads for a member without an Ashed connection", async ({
    request,
  }) => {
    const { cookieHeader } = await setupVsAlliance(request, "viewer");
    const res = await request.get("/vs-performance", {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status()).toBe(200);
  });

  test("scope from a different alliance is denied", async ({ request }) => {
    const first = await setupVsAlliance(request, "officer");
    const second = await setupVsAlliance(request, "officer");

    const firstWeek = (await (
      await request.get("/api/vs-performance/week", {
        headers: { Cookie: first.cookieHeader },
      })
    ).json()) as VsWeekPayload;
    const secondWeekRes = await request.get("/api/vs-performance/week", {
      headers: { Cookie: second.cookieHeader },
    });
    const secondWeek = (await secondWeekRes.json()) as VsWeekPayload;

    const denied = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: second.cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: secondWeek.weekStart,
        opponentName: "Foe",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: firstWeek.scope,
      },
    });
    expect(denied.status()).toBe(409);
  });
});

function todayLocalDate(): string {
  return getServerCalendarDate();
}

test.describe("VS weekly planner UI", () => {
  test("officer plans a future week through the preview dialog and rules reach the train schedule", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));

    await page.goto(`/en-US/vs-performance?week=${futureWeek}`);
    await expect(
      page.getByRole("heading", { name: "Weekly VS plan" }).first(),
    ).toBeVisible();
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    await page
      .getByTestId("vs-plan-platform")
      .first()
      .selectOption("price_is_freight");
    await page.getByTestId("vs-plan-preview").locator("visible=true").click();
    await expect(page.getByTestId("vs-plan-preview-dialog").locator("visible=true")).toBeVisible();
    await expect(
      page.getByTestId("vs-plan-preview-dialog").locator("visible=true").getByText("Planned rule").first(),
    ).toBeVisible();
    await page.getByTestId("vs-plan-apply").locator("visible=true").click();
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    await expect(
      page
        .getByText("Weekly platform: Platform 1 — The Price Is Freight", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/Planned push points/).first()).toBeVisible();

    const painted = await sql`
      SELECT date, conductor_rule
      FROM train_day_configs
      WHERE alliance_id = ${scenario.allianceId}
        AND date >= ${addCalendarDays(futureWeek, 1)}
        AND date <= ${addCalendarDays(futureWeek, 6)}
    `;
    const weekday = painted.filter(
      (row) =>
        (row.conductor_rule as { kind?: string; board?: string } | null)
          ?.kind === "price_is_freight" &&
        (row.conductor_rule as { board?: string } | null)?.board ===
          "weekday",
    );
    const heavyHitter = painted.filter(
      (row) =>
        (row.conductor_rule as { board?: string } | null)?.board ===
        "heavy_hitter",
    );
    expect(weekday.length).toBe(4);
    expect(heavyHitter.length).toBe(1);
  });

  test("hotkey e opens the plan editor", async ({ page }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto("/en-US/vs-performance");
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.locator("body").press("e");
      try {
        await expect(
          page.getByTestId("vs-plan-platform").first(),
        ).toBeVisible({ timeout: 2000 });
        return;
      } catch {
        if (attempt === 2) throw new Error("hotkey e did not open the editor");
      }
    }
  });

  test("past week days are protected and cannot be edited", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    await expect(
      page
        .getByLabel(
          "Completed VS days and past or locked trains stay unchanged.",
        )
        .first(),
    ).toBeVisible();
    for (let i = 0; i < 6; i += 1) {
      await expect(
        page.getByTestId(`vs-plan-day-${i}`).locator("visible=true").getByRole("combobox").first(),
      ).toBeDisabled();
    }
  });

  test("week navigation is locked while a plan draft is dirty", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));
    await page.goto(`/en-US/vs-performance?week=${futureWeek}`);
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    await page
      .getByTestId("vs-plan-day-0").locator("visible=true")
      .getByRole("combobox")
      .first()
      .selectOption("push");
    await expect(page.getByLabel("Previous week").locator("visible=true")).toBeDisabled();
    await expect(page.getByLabel("Next week").locator("visible=true")).toBeDisabled();
  });

  test("defaults save twice without a stale-version error", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto("/en-US/vs-performance");
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    const defaults = page.locator("div", {
      hasText: "Push-day conductor rewards",
    }).last();
    const selects = defaults.getByRole("combobox");
    await selects.nth(0).selectOption("5");
    await defaults.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await selects.nth(1).selectOption("3");
    await defaults.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(defaults.locator("p[role='alert']")).toHaveCount(0);
  });

  test("totals derive the outcome and a correction updates points", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    const cookies = playwrightAuthCookies(scenario.officer);
    await page.context().addCookies(cookies);
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const weekRes = await request.get(
      `/api/vs-performance/week?weekStart=${pastWeek}`,
      { headers: { Cookie: cookieHeader } },
    );
    const week = (await weekRes.json()) as VsWeekPayload;
    await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe Alliance",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });

    const scoreDate = week.days[0]!.scoreDate;
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const row = page.getByTestId(`vs-result-${scoreDate}`);
    await row.getByRole("button", { name: "Result", exact: true }).click();
    await row.getByLabel("Our alliance’s final score").fill("10000000");
    await row.getByLabel("Opponent’s final score").fill("9000000");
    await expect(row.getByText("Result: Won")).toBeVisible();
    await row
      .getByRole("button", { name: "Save final scores", exact: true })
      .click();
    await expect(row.getByText("Won", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Our alliance: 1", { exact: true }),
    ).toBeVisible();

    await row.getByRole("button", { name: "Result", exact: true }).click();
    await row.getByLabel("Our alliance’s final score").fill("8000000");
    await expect(row.getByText("Result: Lost")).toBeVisible();
    await row
      .getByRole("button", { name: "Save final scores", exact: true })
      .click();
    await expect(row.getByText("Lost", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Opponent: 1", { exact: true }),
    ).toBeVisible();
  });

  test("Tuesday scores 2, Saturday scores 4, and corrections recompute actual points", async ({
    page,
    request,
  }) => {
    const { auth, cookieHeader } = await setupVsAlliance(request, "officer");
    await page.context().addCookies(playwrightAuthCookies(auth));
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${pastWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    const matchup = (await (
      await request.patch("/api/vs-performance/matchup", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          weekStart: pastWeek,
          opponentName: "Foe",
          opponentTag: "FOE",
          expectedVersion: 0,
          scope: week.scope,
        },
      })
    ).json()) as NonNullable<VsWeekPayload["matchup"]>;

    const saveDay = async (
      scoreDate: string,
      expectedVersion: number,
      totals: { ourScore: string; opponentScore: string },
    ) => {
      const res = await request.patch(
        `/api/vs-performance/matchup/days/${scoreDate}`,
        {
          headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
          data: {
            matchupId: matchup.id,
            expectedVersion,
            requestId: `e2e-${nanoid(12)}`,
            totals,
            reportedOutcome: null,
            finality: "final",
            scope: week.scope,
          },
        },
      );
      expect(res.ok(), await res.text()).toBeTruthy();
      return (await res.json()) as { version: number };
    };
    const points = async () =>
      ((
        await (
          await request.get(
            `/api/vs-performance/week?weekStart=${pastWeek}`,
            { headers: { Cookie: cookieHeader } },
          )
        ).json()
      ) as VsWeekPayload).points;

    const tuesday = week.days[1]!.scoreDate;
    const saturday = week.days[5]!.scoreDate;
    const tueSave = await saveDay(tuesday, 0, {
      ourScore: "100",
      opponentScore: "50",
    });
    expect((await points()).alliancePoints).toBe(2);
    await saveDay(tuesday, tueSave.version, {
      ourScore: "50",
      opponentScore: "100",
    });
    const corrected = await points();
    expect(corrected.alliancePoints).toBe(0);
    expect(corrected.opponentPoints).toBe(2);
    await saveDay(saturday, 0, { ourScore: "200", opponentScore: "50" });
    const finalPoints = await points();
    expect(finalPoints.alliancePoints).toBe(4);
    expect(finalPoints.opponentPoints).toBe(2);

    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const results = page.getByTestId("vs-matchup-results").locator("visible=true");
    await expect(results).toBeVisible();
    await expect(
      results.getByText("Our alliance: 4", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByTestId("weekly-vs-plan")
        .locator("visible=true")
        .getByText(/Planned push points/),
    ).toBeVisible();
  });

  test("equal totals stay pending until an explicit result is chosen", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    const cookies = playwrightAuthCookies(scenario.officer);
    await page.context().addCookies(cookies);
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${pastWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });

    const scoreDate = week.days[0]!.scoreDate;
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const row = page.getByTestId(`vs-result-${scoreDate}`);
    await row.getByRole("button", { name: "Result", exact: true }).click();
    await row.getByLabel("Our alliance’s final score").fill("9000000");
    await row.getByLabel("Opponent’s final score").fill("9000000");
    await expect(
      row.getByText("Equal totals do not determine a winner.", {
        exact: false,
      }),
    ).toBeVisible();
    await row.getByRole("combobox").selectOption("won");
    await row
      .getByRole("button", { name: "Save final scores", exact: true })
      .click();
    await expect(row.getByText("Won", { exact: true })).toBeVisible();
  });

  test("member sees a read-only page without mutation controls", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.member));
    await page.goto("/en-US/vs-performance");
    await expect(
      page.getByText("Weekly VS plan", { exact: true }).locator("visible=true"),
    ).toBeVisible();
    await expect(page.getByTestId("vs-plan-edit")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Result", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Opponent alliance name", exact: true }),
    ).toHaveCount(0);
  });

  test("weekly PIF podium renders ten ranks with three podium and seven remaining", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));

    await sql`
      INSERT INTO train_week_schedules (id, alliance_id, week_start, is_pivot, created_at, updated_at)
      VALUES (${nanoid(16)}, ${scenario.allianceId}, ${pastWeek}, 0, ${new Date()}, ${new Date()})
      ON CONFLICT (alliance_id, week_start) DO NOTHING
    `;
    const [schedule] = await sql`
      SELECT id FROM train_week_schedules
      WHERE alliance_id = ${scenario.allianceId} AND week_start = ${pastWeek}
    `;
    for (const offset of [1, 2]) {
      const trainDate = addCalendarDays(pastWeek, offset);
      await sql`
        INSERT INTO train_day_configs (id, week_schedule_id, alliance_id, date, conductor_rule, is_override, created_at)
        VALUES (${nanoid(16)}, ${schedule!.id}, ${scenario.allianceId}, ${trainDate}, ${sql.json({ kind: "price_is_freight", board: "weekday" })}, 0, ${new Date()})
        ON CONFLICT (alliance_id, date) DO UPDATE SET conductor_rule = EXCLUDED.conductor_rule
      `;
    }
    for (let i = 0; i < 12; i += 1) {
      const name = `PIF ${String(i).padStart(2, "0")}`;
      const member = await createAllianceRosterMember(sql, {
        allianceId: scenario.allianceId,
        currentName: name,
        allianceRank: 3,
      });
      for (const offset of [0, 1]) {
        const recordedDate = addCalendarDays(pastWeek, offset);
        await sql`
          INSERT INTO vs_score_heads (id, alliance_id, member_id, member_name, recorded_date, period, score, origin, version, basis, updated_at)
          VALUES (${nanoid(16)}, ${scenario.allianceId}, ${member.ashedMemberId}, ${name}, ${recordedDate}, 'daily', ${7_200_000 + (i + 1) * 1000}, 'hq', 1, ${sql.json([])}, ${new Date()})
          ON CONFLICT (alliance_id, member_id, period, recorded_date) DO UPDATE SET score = EXCLUDED.score
        `;
      }
    }

    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const board = page.getByTestId("weekly-pif-podium").first();
    await expect(board).toBeVisible();
    await expect(
      page
        .getByLabel("Top three weekly Price Is Freight commanders")
        .first(),
    ).toBeVisible();
    const remaining = page
      .getByLabel("Weekly Price Is Freight places four through ten")
      .first();
    await expect(remaining.locator("li")).toHaveCount(7);
    await expect(
      board.getByTestId("score-leaderboard-podium-rank-1").first(),
    ).toContainText("PIF 00");
    await expect(
      board.getByTestId("score-leaderboard-podium-rank-2").first(),
    ).toContainText("PIF 01");
    await expect(
      board.getByTestId("score-leaderboard-podium-rank-3").first(),
    ).toContainText("PIF 02");
    const expectedOrder = [
      "PIF 03",
      "PIF 04",
      "PIF 05",
      "PIF 06",
      "PIF 07",
      "PIF 08",
      "PIF 09",
    ];
    for (const [index, name] of expectedOrder.entries()) {
      await expect(remaining.locator("li").nth(index)).toContainText(name);
    }
    await expect(board.getByText("PIF 10")).toHaveCount(0);
    await expect(board.getByText("PIF 11")).toHaveCount(0);
  });

  test("day rows show theme, point value, and train date", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const weekStart = getWeekStartMonday(todayLocalDate());
    await page.goto("/en-US/vs-performance");
    const firstDay = page.getByTestId("vs-plan-day-0").locator("visible=true");
    await expect(firstDay.getByText("Radar Training")).toBeVisible();
    await expect(firstDay.getByText("1 point")).toBeVisible();
    await expect(firstDay.getByText(/Train:/)).toBeVisible();
    const lastDay = page.getByTestId("vs-plan-day-5").locator("visible=true");
    await expect(lastDay.getByText("Buster Day")).toBeVisible();
    await expect(lastDay.getByText("4 points")).toBeVisible();
    await expect(page.getByText(/Planned push points/)).toBeVisible();
    await expect(
      page.getByText("No VS plan has been set for this week.", { exact: true }),
    ).toBeVisible();
    expect(weekStart).toBeTruthy();
  });

  test("pt-BR totals entry derives and saves a result", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    const cookies = playwrightAuthCookies(scenario.officer);
    await page.context().addCookies(cookies);
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${pastWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });

    const scoreDate = week.days[0]!.scoreDate;
    await page.goto(`/pt-BR/vs-performance?week=${pastWeek}`);
    const row = page.getByTestId(`vs-result-${scoreDate}`);
    await row.getByRole("button", { name: "Resultado", exact: true }).click();
    await row
      .getByLabel("Pontuação final da nossa aliança")
      .fill("1.234.567");
    await row.getByLabel("Pontuação final do adversário").fill("1.234.566");
    await row
      .getByRole("button", { name: "Salvar pontuações finais", exact: true })
      .click();
    await expect(row.getByText("Vitória", { exact: true })).toBeVisible();
  });

  test("Ashed pane is hidden without a connection and no import control shows", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto("/en-US/vs-performance");
    await expect(
      page.getByText("Weekly VS plan", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Refresh matchup from Ashed" }),
    ).toHaveCount(0);
  });

  test("strategic victory preserves a manual train override until reapply is ticked", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    const cookies = playwrightAuthCookies(scenario.officer);
    await page.context().addCookies(cookies);
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${futureWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    const thursdayTrainDate = week.days[3]!.trainDate;

    const overrideRule = { kind: "rank_pool", pool: "r3", draw: "wheel" };
    const trainRule = async () =>
      (
        await sql<{ conductor_rule: { kind?: string; topN?: number } | null }[]>`
        SELECT conductor_rule FROM train_day_configs
        WHERE alliance_id = ${scenario.allianceId} AND date = ${thursdayTrainDate}
      `
      )[0]?.conductor_rule ?? null;

    await page.goto(`/en-US/vs-performance?week=${futureWeek}`);
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    await page
      .getByTestId("vs-plan-day-3").locator("visible=true")
      .getByRole("combobox")
      .first()
      .selectOption("push");
    await page.getByTestId("vs-plan-preview").locator("visible=true").click();
    await page.getByTestId("vs-plan-apply").locator("visible=true").click();
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    expect((await trainRule())?.kind).toBe("vs_top_n");

    await sql`
      UPDATE train_day_configs
      SET conductor_rule = ${sql.json(overrideRule)}, is_override = 1
      WHERE alliance_id = ${scenario.allianceId} AND date = ${thursdayTrainDate}
    `;
    await page.reload();

    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    await page
      .getByTestId("vs-plan-day-4").locator("visible=true")
      .getByRole("combobox")
      .first()
      .selectOption("push");
    await page.getByTestId("vs-plan-preview").locator("visible=true").click();
    await page.getByTestId("vs-plan-apply").locator("visible=true").click();
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    expect(await trainRule()).toEqual(overrideRule);

    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    await page.getByTestId("vs-plan-day-3").locator("visible=true").getByRole("checkbox").check();
    await page.getByTestId("vs-plan-preview").locator("visible=true").click();
    await page.getByTestId("vs-plan-apply").locator("visible=true").click();
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    expect((await trainRule())?.kind).toBe("vs_top_n");
  });

  test("a mid-commit failure rolls back the plan row and every painted config", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { alliance, cookieHeader } = await setupVsAlliance(request, "officer");
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${futureWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;

    const draft = {
      weekStart: futureWeek,
      platform: "strategic_victory",
      days: week.days.map((day, index) => ({
        scoreDate: day.scoreDate,
        strategy: index < 2 ? "push" : "undecided",
        pushTopN: 1,
        heavyHitterReward: false,
      })),
    };
    const previewRes = await request.post(
      "/api/vs-performance/week/preview",
      {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          draft,
          expectedVersion: 0,
          scope: week.scope,
          reapplyDates: [],
        },
      },
    );
    expect(previewRes.ok(), await previewRes.text()).toBeTruthy();
    const preview = (await previewRes.json()) as {
      planVersion: number;
      fingerprint: string;
      scope: string;
    };

    const failingDate = week.days[1]!.trainDate;
    await sql.unsafe(`CREATE OR REPLACE FUNCTION e2e_fail_second_paint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.conductor_rule::text LIKE '%vs_top_n%' AND NEW.date = '${failingDate}' THEN
          RAISE EXCEPTION 'e2e_fail_paint';
        END IF;
        RETURN NEW;
      END;
    $$`);
    await sql`CREATE TRIGGER e2e_fail_paint_trigger BEFORE INSERT OR UPDATE ON train_day_configs
      FOR EACH ROW EXECUTE FUNCTION e2e_fail_second_paint()`;
    try {
      const saveRes = await request.patch("/api/vs-performance/week", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: {
          draft,
          reapplyDates: [],
          expectedVersion: preview.planVersion,
          fingerprint: preview.fingerprint,
          scope: preview.scope,
        },
      });
      expect(saveRes.ok()).toBeFalsy();
    } finally {
      await sql`DROP TRIGGER IF EXISTS e2e_fail_paint_trigger ON train_day_configs`;
      await sql`DROP FUNCTION IF EXISTS e2e_fail_second_paint()`;
    }

    const [planCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM vs_week_plans
      WHERE alliance_id = ${alliance.allianceId} AND week_start = ${futureWeek}
    `;
    expect(planCount!.count).toBe(0);
    const [paintedCount] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM train_day_configs
      WHERE alliance_id = ${alliance.allianceId}
        AND conductor_rule::text LIKE ${"%vs_top_n%"}
    `;
    expect(paintedCount!.count).toBe(0);
  });

  test("concurrent plan saves serialize: one commits, the other gets stale", async ({
    request,
  }) => {
    const { cookieHeader } = await setupVsAlliance(request, "officer");
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${futureWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    const draft = {
      weekStart: futureWeek,
      platform: "strategic_victory",
      days: week.days.map((day, index) => ({
        scoreDate: day.scoreDate,
        strategy: index === 0 ? "push" : "undecided",
        pushTopN: 1,
        heavyHitterReward: false,
      })),
    };
    const preview = (await (
      await request.post("/api/vs-performance/week/preview", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { draft, expectedVersion: 0, scope: week.scope, reapplyDates: [] },
      })
    ).json()) as { planVersion: number; fingerprint: string; scope: string };

    const body = JSON.stringify({
      draft,
      reapplyDates: [],
      expectedVersion: preview.planVersion,
      fingerprint: preview.fingerprint,
      scope: preview.scope,
    });
    const [first, second] = await Promise.all([
      request.patch("/api/vs-performance/week", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: JSON.parse(body),
      }),
      request.patch("/api/vs-performance/week", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: JSON.parse(body),
      }),
    ]);
    const statuses = [first.status(), second.status()].sort();
    expect(statuses).toEqual([200, 409]);
  });

  test("a plan change after preview rejects the commit as stale", async ({
    request,
  }) => {
    const { cookieHeader } = await setupVsAlliance(request, "officer");
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${futureWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    const draft = {
      weekStart: futureWeek,
      platform: "strategic_victory",
      days: week.days.map((day, index) => ({
        scoreDate: day.scoreDate,
        strategy: index === 0 ? "push" : "undecided",
        pushTopN: 1,
        heavyHitterReward: false,
      })),
    };
    const preview = (await (
      await request.post("/api/vs-performance/week/preview", {
        headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
        data: { draft, expectedVersion: 0, scope: week.scope, reapplyDates: [] },
      })
    ).json()) as { planVersion: number; fingerprint: string; scope: string };

    const first = await request.patch("/api/vs-performance/week", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        draft,
        reapplyDates: [],
        expectedVersion: preview.planVersion,
        fingerprint: preview.fingerprint,
        scope: preview.scope,
      },
    });
    expect(first.ok(), await first.text()).toBeTruthy();

    const replay = await request.patch("/api/vs-performance/week", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        draft,
        reapplyDates: [],
        expectedVersion: preview.planVersion,
        fingerprint: preview.fingerprint,
        scope: preview.scope,
      },
    });
    expect(replay.status()).toBe(409);
  });

  test("a failed week load does not auto-retry until Retry is clicked", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    let calls = 0;
    await page.route("**/api/vs-performance/week**", async (route) => {
      if (route.request().url().includes(`weekStart=${pastWeek}`)) {
        calls += 1;
        if (calls === 1) return route.abort();
      }
      return route.continue();
    });
    await page.route(
      (url) => url.search.includes("_rsc="),
      () => new Promise(() => {}),
    );
    await page.goto("/en-US/vs-performance");
    await expect(page.getByTestId("weekly-vs-plan").locator("visible=true")).toBeVisible();
    await page.evaluate((week) => {
      const url = new URL(window.location.href);
      url.searchParams.set("week", week);
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
    }, pastWeek);
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(600);
    expect(calls).toBe(1);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
    expect(calls).toBe(2);
  });

  test("editing totals after a failed save issues a fresh request", async ({
    page,
    request,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    const cookies = playwrightAuthCookies(scenario.officer);
    await page.context().addCookies(cookies);
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const pastWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), -7));
    const week = (await (
      await request.get(`/api/vs-performance/week?weekStart=${pastWeek}`, {
        headers: { Cookie: cookieHeader },
      })
    ).json()) as VsWeekPayload;
    await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: pastWeek,
        opponentName: "Foe",
        opponentTag: "FOE",
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    const scoreDate = week.days[0]!.scoreDate;
    let patchCalls = 0;
    await page.route(`**/api/vs-performance/matchup/days/${scoreDate}`, async (route) => {
      patchCalls += 1;
      if (patchCalls === 1) {
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "save", code: "save" }),
        });
      }
      return route.continue();
    });
    await page.goto(`/en-US/vs-performance?week=${pastWeek}`);
    const row = page.getByTestId(`vs-result-${scoreDate}`);
    await row.getByRole("button", { name: "Result", exact: true }).click();
    await row.getByLabel("Our alliance’s final score").fill("9000000");
    await row.getByLabel("Opponent’s final score").fill("8000000");
    await row.getByRole("button", { name: "Save final scores", exact: true }).click();
    await expect(row.getByRole("alert")).toBeVisible();
    await row.getByLabel("Opponent’s final score").fill("7000000");
    await row.getByRole("button", { name: "Save final scores", exact: true }).click();
    await expect(row.getByText("Won", { exact: true })).toBeVisible();
    expect(patchCalls).toBe(2);
  });

  test("cancelling the editor restores persisted push defaults", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto("/en-US/vs-performance");
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    const monSelect = page.locator("#vs-default-mon");
    await expect(monSelect).toHaveValue("1");
    await monSelect.selectOption("3");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    await expect(page.locator("#vs-default-mon")).toHaveValue("1");
  });

  test("browser back during a dirty plan edit keeps the draft", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    await page.goto("/en-US/vs-performance");
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    const nextWeekButton = page.getByLabel("Next week").locator("visible=true");
    await expect(nextWeekButton).toBeEnabled();
    await nextWeekButton.click();
    await page.waitForURL(/week=/);
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    const select = page
      .getByTestId("vs-plan-day-0").locator("visible=true")
      .getByRole("combobox")
      .first();
    await select.selectOption("push");
    await page.goBack();
    await expect(select).toHaveValue("push");
  });

  test("clean week navigation round-trips through history", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));
    await page.goto(`/en-US/vs-performance?week=${futureWeek}`);
    await page.getByLabel("Next week").locator("visible=true").click();
    await page.waitForURL((url) => !url.search.includes(`week=${futureWeek}`));
    await page.goBack();
    await page.waitForURL((url) => url.search.includes(`week=${futureWeek}`));
    await expect(page.getByTestId("weekly-vs-plan").locator("visible=true")).toBeVisible();
  });

  async function clientNavigateVsWeek(page: Page, week: string) {
    await page.evaluate((targetWeek) => {
      const url = new URL(window.location.href);
      url.searchParams.set("week", targetWeek);
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, week);
  }

  async function waitForVsWeekClientFetch(
    page: Page,
    week: string,
    readCalls: () => number,
    timeoutMs = 30_000,
  ) {
    await expect
      .poll(
        async () => {
          if (readCalls() === 0) {
            await clientNavigateVsWeek(page, week);
          }
          return readCalls();
        },
        { timeout: timeoutMs },
      )
      .toBeGreaterThan(0);
  }

  async function attachSecondAlliance(sessionId: string, hqUserId: string) {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `VB${nanoid(4)}`,
      name: "VS Second Alliance",
    });
    await createAllianceMembership(sql, {
      hqUserId,
      allianceId: alliance.allianceId,
      roleName: "officer",
      source: "manual",
    });
    const member = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: "VS Officer B",
      allianceRank: 4,
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId,
      ashedMemberId: member.ashedMemberId,
    });
    await sql`
      UPDATE sessions
      SET alliance_id = ${alliance.allianceId},
          current_alliance_id = ${alliance.allianceId},
          alliance_tag = ${alliance.tag}
      WHERE id = ${sessionId}
    `;
    return alliance;
  }

  async function seedOpponent(
    request: APIRequestContext,
    cookieHeader: string,
    weekStart: string,
    opponentName: string,
  ) {
    const weekRes = await request.get(
      `/api/vs-performance/week?weekStart=${weekStart}`,
      { headers: { Cookie: cookieHeader } },
    );
    const week = (await weekRes.json()) as VsWeekPayload;
    const res = await request.patch("/api/vs-performance/matchup", {
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      data: {
        weekStart: week.weekStart,
        opponentName,
        opponentTag: opponentName.slice(0, 4).toUpperCase(),
        expectedVersion: 0,
        scope: week.scope,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return week;
  }

  test("same-context week refresh while dirty retains the draft", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const futureWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 7));
    const refreshWeek = getWeekStartMonday(addCalendarDays(todayLocalDate(), 14));
    await page.goto(`/en-US/vs-performance?week=${futureWeek}`);
    await page.getByTestId("vs-plan-edit").locator("visible=true").click();
    const select = page
      .getByTestId("vs-plan-day-0").locator("visible=true")
      .getByRole("combobox")
      .first();
    await select.selectOption("push");
    await page.evaluate((week) => {
      const url = new URL(window.location.href);
      url.searchParams.set("week", week);
      window.history.pushState({}, "", `${url.pathname}${url.search}`);
    }, refreshWeek);
    await expect(select).toHaveValue("push");
    const futureTitle = new Date(`${refreshWeek}T12:00:00`).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" },
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: new RegExp(futureTitle.replace(/\./g, "\\.")) }),
    ).toBeVisible();
  });

  test("a new-context initial payload replaces old-scope content", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    const cookies = playwrightAuthCookies(scenario.officer);
    await page.context().addCookies(cookies);
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const currentWeek = getWeekStartMonday(todayLocalDate());
    const nextWeek = getWeekStartMonday(addCalendarDays(currentWeek, 7));
    await seedOpponent(request, cookieHeader, currentWeek, "Foe Alliance");
    await page.goto("/en-US/vs-performance");
    await expect(page.getByText("Foe Alliance").first()).toBeVisible();
    await attachSecondAlliance(
      scenario.officer.sessionId,
      scenario.officer.hqUserId,
    );
    await page.getByLabel("Next week").locator("visible=true").click();
    const nextTitle = new Date(`${nextWeek}T12:00:00`).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" },
    );
    await expect(
      page.getByRole("heading", {
        name: new RegExp(nextTitle.replace(/\./g, "\\.")),
      }),
    ).toBeVisible();
    await expect(page.locator('text="Foe Alliance":visible')).toHaveCount(0);
    await expect(page.getByTestId("vs-plan-edit").locator("visible=true")).toBeVisible();
    await expect(
      page.getByTestId("vs-plan-day-0").locator("visible=true").first().getByRole("combobox"),
    ).toHaveCount(0);
  });

  test("a late old-context week response cannot restore old names", async ({
    page,
    request,
  }) => {
    const sql = getE2eSql();
    const scenario = await createNativeVsScenario(sql);
    const cookies = playwrightAuthCookies(scenario.officer);
    await page.context().addCookies(cookies);
    const cookieHeader = cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    const currentWeek = getWeekStartMonday(todayLocalDate());
    const nextWeek = getWeekStartMonday(addCalendarDays(currentWeek, 7));
    await seedOpponent(request, cookieHeader, currentWeek, "Foe Alliance");
    const aPayload = await seedOpponent(
      request,
      cookieHeader,
      nextWeek,
      "Foe Alliance",
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let apiCalls = 0;
    await page.route("**/api/vs-performance/week**", async (route) => {
      const target = new URL(route.request().url()).searchParams.get(
        "weekStart",
      );
      if (target !== nextWeek) {
        return route.continue();
      }
      apiCalls += 1;
      await gate;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(aPayload),
      });
    });
    await page.goto("/en-US/vs-performance");
    await expect(page.getByText("Foe Alliance").first()).toBeVisible();
    await page.route(
      (url) => url.search.includes("_rsc="),
      () => new Promise(() => {}),
    );
    await waitForVsWeekClientFetch(page, nextWeek, () => apiCalls);
    await attachSecondAlliance(
      scenario.officer.sessionId,
      scenario.officer.hqUserId,
    );
    await clientNavigateVsWeek(page, currentWeek);
    const lateResponse = page.waitForResponse((res) =>
      res.url().includes(`weekStart=${nextWeek}`),
    );
    release();
    await lateResponse;
    await expect(page.locator('text="Foe Alliance":visible')).toHaveCount(0);
    await expect(page.getByLabel("Next week").locator("visible=true")).toBeEnabled();
    await expect(page.getByTestId("weekly-vs-plan").locator("visible=true")).toBeVisible();
  });

  test("server initial accepted while a client week request is in flight", async ({
    page,
  }) => {
    const scenario = await createNativeVsScenario(getE2eSql());
    await page.context().addCookies(playwrightAuthCookies(scenario.officer));
    const currentWeek = getWeekStartMonday(todayLocalDate());
    const nextWeek = getWeekStartMonday(addCalendarDays(currentWeek, 7));
    await page.route("**/api/vs-performance/week**", () => new Promise(() => {}));
    await page.goto("/en-US/vs-performance");
    await expect(
      page.locator('[data-testid="weekly-vs-plan"]:visible'),
    ).toHaveCount(1);
    await page
      .getByRole("button", { name: "Next week" })
      .locator("visible=true")
      .click();
    const nextTitle = new Date(`${nextWeek}T12:00:00`).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric" },
    );
    await expect(
      page
        .getByRole("heading", {
          name: new RegExp(nextTitle.replace(/\./g, "\\.")),
        })
        .locator("visible=true"),
    ).toHaveCount(1);
    await expect(
      page.getByLabel("Previous week").locator("visible=true"),
    ).toBeEnabled();
    await expect(
      page.getByLabel("Next week").locator("visible=true"),
    ).toBeEnabled();
  });
});
