import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createNativeAlliance,
  getE2eSql,
} from "./fixtures/db";

/**
 * Officer Intelligence is gated by `officer_intel:read` / `officer_intel:write`
 * (see src/lib/officer-intel/route-helpers.server.ts). Viewer role does not get
 * `officer_intel:read`; data_entry gets `:read` but not `:write`.
 */
test.describe("Officer Intel RBAC", () => {
  test("no session cookie is unauthorized", async ({ request }) => {
    const list = await request.get("/api/officer-intel/sessions");
    expect(list.status(), await list.text()).toBe(401);

    const ask = await request.post("/api/officer-intel/ask", {
      data: { question: "What did we decide?" },
    });
    expect(ask.status(), await ask.text()).toBe(401);
  });

  test("viewer role cannot read officer intel sessions", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `OIV${nanoid(4)}`,
      name: "Officer Intel Viewer Test",
    });
    const user = await createAuthenticatedHqSession(
      sql,
      `officer-intel-viewer-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: user.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "viewer",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${user.sessionId}
    `;

    const list = await request.get("/api/officer-intel/sessions", {
      headers: { Cookie: authCookieHeader(user) },
    });
    expect(list.status(), await list.text()).toBe(403);

    const ask = await request.post("/api/officer-intel/ask", {
      headers: { Cookie: authCookieHeader(user) },
      data: { question: "What did we decide?" },
    });
    expect(ask.status(), await ask.text()).toBe(403);
  });

  test("data_entry role can read but not create officer intel sessions", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `OID${nanoid(4)}`,
      name: "Officer Intel Data Entry Test",
    });
    const user = await createAuthenticatedHqSession(
      sql,
      `officer-intel-data-entry-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: user.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "data_entry",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${user.sessionId}
    `;

    const list = await request.get("/api/officer-intel/sessions", {
      headers: { Cookie: authCookieHeader(user) },
    });
    expect(list.status(), await list.text()).toBe(200);

    const create = await request.post("/api/officer-intel/sessions", {
      headers: { Cookie: authCookieHeader(user) },
      data: { title: "Should be denied" },
    });
    expect(create.status(), await create.text()).toBe(403);

    const ask = await request.post("/api/officer-intel/ask", {
      headers: { Cookie: authCookieHeader(user) },
      data: { question: "What did we decide?" },
    });
    expect([200, 503], await ask.text()).toContain(ask.status());
  });

  test("owner role can read and create officer intel sessions", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `OIO${nanoid(4)}`,
      name: "Officer Intel Owner Test",
    });
    const user = await createAuthenticatedHqSession(
      sql,
      `officer-intel-owner-${nanoid(6)}@e2e.test`,
    );
    await createAllianceMembership(sql, {
      hqUserId: user.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "owner",
      source: "manual",
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${user.sessionId}
    `;

    const list = await request.get("/api/officer-intel/sessions", {
      headers: { Cookie: authCookieHeader(user) },
    });
    expect(list.status(), await list.text()).toBe(200);

    const create = await request.post("/api/officer-intel/sessions", {
      headers: { Cookie: authCookieHeader(user) },
      data: { title: "VS chat capture" },
    });
    expect(create.status(), await create.text()).toBe(200);
    const body = (await create.json()) as { sessionId?: string };
    expect(typeof body.sessionId).toBe("string");

    const askMissingQuestion = await request.post("/api/officer-intel/ask", {
      headers: { Cookie: authCookieHeader(user) },
      data: {},
    });
    expect(askMissingQuestion.status(), await askMissingQuestion.text()).toBe(
      400,
    );
  });
});
