import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

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

function cookieHeaderFor(sessionId: string, nextAuthToken: string): string {
  return playwrightAuthCookies({ sessionId, nextAuthToken })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function setupOfficerAlliance() {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `NS${nanoid(4)}`,
    name: "Numbered Spins E2E Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail("numbered-spin-officer"),
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

  const members = [];
  for (const name of ["Alpha VR", "Bravo VR", "Charlie VR"]) {
    const m = await createAllianceRosterMember(sql, {
      allianceId: alliance.allianceId,
      currentName: name,
    });
    const commanderId = `e2e-cmd-${nanoid(12)}`;
    await sql`
      INSERT INTO commanders (id, game_uid, primary_name, created_at, updated_at)
      VALUES (${commanderId}, ${`999${Math.floor(100_000_000_000 + Math.random() * 899_999_999_999)}`}, ${name}, NOW(), NOW())
    `;
    await sql`
      INSERT INTO commander_alliance_memberships (id, commander_id, alliance_id, ashed_member_id, status)
      VALUES (${nanoid()}, ${commanderId}, ${alliance.allianceId}, ${m.ashedMemberId}, 'active')
    `;
    members.push({ ...m, currentName: name });
  }

  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;

  return {
    sql,
    allianceId: alliance.allianceId,
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
    cookieHeader: cookieHeaderFor(auth.sessionId, auth.nextAuthToken),
    members,
  };
}

test.describe("Numbered conductor & VIP spins", () => {
  test("rolls 1..N fallback when Top-N VR scores are missing, rejects non-Top-N, and auto-backfills on VR score upload", async ({
    request,
    baseURL,
  }) => {
    const fx = await setupOfficerAlliance();
    const trainDate = "2026-11-26";
    const nonTopNDate = "2026-11-27";

    // Seed trainDate as vr_top_n (topN: 3) directly in train_day_configs
    // (simulating a pre-painted VR Top 3 day before scores are uploaded)
    // and paint nonTopNDate as rank_pool (r3) via API.
    await fx.sql`
      INSERT INTO train_day_configs (id, alliance_id, date, conductor_rule, vip_rule)
      VALUES (
        ${nanoid()},
        ${fx.allianceId},
        ${trainDate},
        ${JSON.stringify({ kind: "vr_top_n", topN: 3 })}::jsonb,
        NULL
      )
    `;

    const paintPoolRes = await request.patch(
      `${baseURL}/api/trains/schedule/days`,
      {
        headers: {
          cookie: fx.cookieHeader,
          "content-type": "application/json",
        },
        data: {
          dates: [nonTopNDate],
          conductorRule: { kind: "rank_pool", pool: "r3", draw: "wheel" },
          vipRule: null,
        },
      },
    );
    expect(paintPoolRes.ok(), await paintPoolRes.text()).toBe(true);

    // 1. Normal roll on vr_top_n with no VR scores is blocked
    const blockedRes = await request.post(
      `${baseURL}/api/trains/conductor/roll`,
      {
        headers: {
          cookie: fx.cookieHeader,
          "content-type": "application/json",
        },
        data: { date: trainDate, role: "conductor" },
      },
    );
    expect(blockedRes.ok()).toBe(false);

    // 2. Non-Top-N rule rejects numberedFallback
    const invalidFallbackRes = await request.post(
      `${baseURL}/api/trains/conductor/roll`,
      {
        headers: {
          cookie: fx.cookieHeader,
          "content-type": "application/json",
        },
        data: {
          date: nonTopNDate,
          role: "conductor",
          numberedFallback: true,
        },
      },
    );
    expect(invalidFallbackRes.ok()).toBe(false);

    // 3. Numbered fallback on vr_top_n succeeds and persists rank 1..3
    const numberedRes = await request.post(
      `${baseURL}/api/trains/conductor/roll`,
      {
        headers: {
          cookie: fx.cookieHeader,
          "content-type": "application/json",
        },
        data: {
          date: trainDate,
          role: "conductor",
          numberedFallback: true,
        },
      },
    );
    expect(numberedRes.ok()).toBe(true);
    const numberedBody = (await numberedRes.json()) as {
      result: {
        numberedRank: number;
        numberedPoolSize: number;
        wheelCandidates: Array<{ memberName: string }>;
      };
    };
    const drawnRank = numberedBody.result.numberedRank;
    expect(drawnRank).toBeGreaterThanOrEqual(1);
    expect(drawnRank).toBeLessThanOrEqual(3);
    expect(numberedBody.result.numberedPoolSize).toBe(3);
    expect(numberedBody.result.wheelCandidates.map((c) => c.memberName)).toEqual([
      "#1",
      "#2",
      "#3",
    ]);

    const [beforeBackfill] = await fx.sql`
      SELECT conductor_member_id, conductor_numbered_rank, conductor_numbered_pool_size
      FROM train_conductor_records
      WHERE alliance_id = ${fx.allianceId} AND date = ${trainDate}
    `;
    expect(beforeBackfill?.conductor_member_id).toBeNull();
    expect(beforeBackfill?.conductor_numbered_rank).toBe(drawnRank);
    expect(beforeBackfill?.conductor_numbered_pool_size).toBe(3);

    // 4. Upload VR scores for the 3 members via officer override -> triggers auto-backfill
    const scores = [
      { member: fx.members[0]!, baseVr: 3000 },
      { member: fx.members[1]!, baseVr: 2000 },
      { member: fx.members[2]!, baseVr: 1000 },
    ];
    for (const { member, baseVr } of scores) {
      const vrRes = await request.post(`${baseURL}/api/vr/officer`, {
        headers: {
          cookie: fx.cookieHeader,
          "content-type": "application/json",
        },
        data: {
          ashedMemberId: member.ashedMemberId,
          baseVr,
          instituteLevel: 10,
          reason: "e2e numbered spin backfill",
        },
      });
      expect(vrRes.ok()).toBe(true);
    }

    const expectedWinner = scores[drawnRank - 1]!.member;
    const [afterBackfill] = await fx.sql`
      SELECT conductor_member_id, conductor_member_name
      FROM train_conductor_records
      WHERE alliance_id = ${fx.allianceId} AND date = ${trainDate}
    `;
    expect(afterBackfill?.conductor_member_id).toBe(
      expectedWinner.ashedMemberId,
    );
    expect(afterBackfill?.conductor_member_name).toBe(
      expectedWinner.currentName,
    );
  });

  test("UI shows Spin #1–N fallback CTA when blocked on missing scores and displays pending rank badge", async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const fx = await setupOfficerAlliance();
    const trainDate = "2026-11-26";

    const paintRes = await request.patch(`${baseURL}/api/trains/schedule/days`, {
      headers: {
        cookie: fx.cookieHeader,
        "content-type": "application/json",
      },
      data: {
        dates: [trainDate],
        conductorRule: { kind: "vs_top_n", topN: 3 },
        vipRule: null,
      },
    });
    expect(paintRes.ok(), await paintRes.text()).toBe(true);

    await context.addCookies(
      playwrightAuthCookies({
        sessionId: fx.sessionId,
        nextAuthToken: fx.nextAuthToken,
      }),
    );

    await page.goto(`/en-US/trains?date=${trainDate}`);
    await expect(
      page.getByRole("button", { name: /spin/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /spin/i }).first().click();

    const numberedBtn = page.getByTestId("trains-wheel-blocked-numbered-spin");
    await expect(numberedBtn).toBeVisible({ timeout: 10_000 });
    await expect(numberedBtn).toContainText("Spin #1–3 instead");

    const [rollResponse] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes("/api/trains/conductor/roll") &&
          res.request().method() === "POST",
      ),
      numberedBtn.click(),
    ]);
    expect(rollResponse.ok()).toBe(true);

    // Reload to verify the pending numbered rank is persisted and rendered
    await page.reload();
    await expect(page.getByTestId("trains-numbered-spin-pending")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("trains-numbered-spin-pending"),
    ).toContainText(/#[1-3] of 3 \(awaiting scores\)/);
  });
});
