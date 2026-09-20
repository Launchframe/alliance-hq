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

type Fixture = { cookieHeader: string; allianceId: string; tag: string };

function cookieHeaderFor(sessionId: string, nextAuthToken: string): string {
  return playwrightAuthCookies({ sessionId, nextAuthToken })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

async function setupOfficer(): Promise<
  Fixture & { sessionId: string; nextAuthToken: string }
> {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `TE${nanoid(4)}`,
    name: "Top Score Eligibility Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail("top-score-officer"),
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
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Top Score Roster Member",
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;

  return {
    cookieHeader: cookieHeaderFor(auth.sessionId, auth.nextAuthToken),
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
    allianceId: alliance.allianceId,
    tag: alliance.tag,
  };
}

async function addMemberTo(
  fixture: Fixture,
  roleName: "member" | "viewer",
): Promise<{ cookieHeader: string }> {
  const sql = getE2eSql();
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail("top-score-viewer"),
  );
  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: fixture.allianceId,
    roleName,
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: fixture.allianceId,
    hqUserId: auth.hqUserId,
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${fixture.allianceId},
        alliance_id = ${fixture.allianceId},
        alliance_tag = ${fixture.tag}
    WHERE id = ${auth.sessionId}
  `;
  return { cookieHeader: cookieHeaderFor(auth.sessionId, auth.nextAuthToken) };
}

function eligibilityPath(tag: string): string {
  return `/api/alliance/${encodeURIComponent(tag.toLowerCase())}/train-top-score-eligibility`;
}

test.describe("Train top score eligibility", () => {
  test("a new alliance defaults to minimum R3 with R4/R5 included", async ({
    request,
  }) => {
    const officer = await setupOfficer();

    const res = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: officer.cookieHeader },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.trainTopScoreMinRank).toBe(3);
    expect(body.trainTopScoreIncludesR4Plus).toBe(true);
    expect(body.canManage).toBe(true);
  });

  test("a trains officer can lower the minimum and disable R4/R5", async ({
    request,
  }) => {
    const officer = await setupOfficer();

    const patch = await request.patch(eligibilityPath(officer.tag), {
      headers: {
        Cookie: officer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { trainTopScoreMinRank: 2, trainTopScoreIncludesR4Plus: false },
    });
    expect(patch.status(), await patch.text()).toBe(200);
    const patched = await patch.json();
    expect(patched.trainTopScoreMinRank).toBe(2);
    expect(patched.trainTopScoreIncludesR4Plus).toBe(false);

    const after = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: officer.cookieHeader },
    });
    const body = await after.json();
    expect(body.trainTopScoreMinRank).toBe(2);
    expect(body.trainTopScoreIncludesR4Plus).toBe(false);
  });

  test("a view-only member can read but not change the setting", async ({
    request,
  }) => {
    const officer = await setupOfficer();
    const member = await addMemberTo(officer, "member");

    const res = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: member.cookieHeader },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.trainTopScoreMinRank).toBe(3);
    expect(body.trainTopScoreIncludesR4Plus).toBe(true);
    expect(body.canManage).toBe(false);

    const patch = await request.patch(eligibilityPath(officer.tag), {
      headers: {
        Cookie: member.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { trainTopScoreMinRank: 1, trainTopScoreIncludesR4Plus: false },
    });
    expect(patch.status()).toBe(403);
  });

  test("the tag route stays scoped to the session's alliance", async ({
    request,
  }) => {
    const officer = await setupOfficer();
    const outsider = await setupOfficer();
    expect(outsider.tag).not.toBe(officer.tag);

    const res = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: outsider.cookieHeader },
    });
    expect(res.status()).toBe(403);

    const patch = await request.patch(eligibilityPath(officer.tag), {
      headers: {
        Cookie: outsider.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { trainTopScoreMinRank: 1, trainTopScoreIncludesR4Plus: false },
    });
    expect(patch.status()).toBe(403);

    const after = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: officer.cookieHeader },
    });
    const body = await after.json();
    expect(body.trainTopScoreMinRank).toBe(3);
    expect(body.trainTopScoreIncludesR4Plus).toBe(true);
  });

  test("officer adjusts the minimum rank slider on the trains settings page", async ({
    page,
    request,
  }) => {
    const officer = await setupOfficer();

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: officer.sessionId,
        nextAuthToken: officer.nextAuthToken,
      }),
    );

    await page.goto("/settings/trains");

    const section = page.getByTestId("train-top-score-eligibility-settings");
    await expect(section).toBeVisible();

    const slider = page.getByTestId("train-top-score-min-rank");
    await expect(slider).toHaveValue("3");
    await expect(slider).toHaveCSS("background-image", /linear-gradient/);
    await expect(slider).toHaveCSS("background-image", /100%/);

    await slider.fill("2");
    await expect(slider).toHaveCSS("background-image", /50%/);
    await expect(
      section.getByText("R2 and R3 members are eligible."),
    ).toBeVisible();

    const patchResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/train-top-score-eligibility") &&
        res.request().method() === "PATCH",
    );
    await section.getByRole("button", { name: "Save" }).click();
    expect((await patchResponse).status()).toBe(200);

    const after = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: officer.cookieHeader },
    });
    const body = await after.json();
    expect(body.trainTopScoreMinRank).toBe(2);
    expect(body.trainTopScoreIncludesR4Plus).toBe(true);
  });
});
