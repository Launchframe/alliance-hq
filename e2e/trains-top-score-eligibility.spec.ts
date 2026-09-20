import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createAllianceMembership,
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

async function setupOfficer(): Promise<Fixture> {
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
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;

  return {
    cookieHeader: cookieHeaderFor(auth.sessionId, auth.nextAuthToken),
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
  test("a new alliance defaults to including R4/R5", async ({ request }) => {
    const officer = await setupOfficer();

    const res = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: officer.cookieHeader },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.trainTopScoreIncludesR4Plus).toBe(true);
    expect(body.canManage).toBe(true);
  });

  test("a trains officer can disable it and GET reflects the change", async ({
    request,
  }) => {
    const officer = await setupOfficer();

    const patch = await request.patch(eligibilityPath(officer.tag), {
      headers: {
        Cookie: officer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { trainTopScoreIncludesR4Plus: false },
    });
    expect(patch.status(), await patch.text()).toBe(200);
    expect((await patch.json()).trainTopScoreIncludesR4Plus).toBe(false);

    const after = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: officer.cookieHeader },
    });
    expect((await after.json()).trainTopScoreIncludesR4Plus).toBe(false);
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
    expect(body.trainTopScoreIncludesR4Plus).toBe(true);
    expect(body.canManage).toBe(false);

    const patch = await request.patch(eligibilityPath(officer.tag), {
      headers: {
        Cookie: member.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { trainTopScoreIncludesR4Plus: false },
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
      data: { trainTopScoreIncludesR4Plus: false },
    });
    expect(patch.status()).toBe(403);

    const after = await request.get(eligibilityPath(officer.tag), {
      headers: { Cookie: officer.cookieHeader },
    });
    expect((await after.json()).trainTopScoreIncludesR4Plus).toBe(true);
  });
});
