import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  authCookieHeader,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
} from "./fixtures/db";
import { createMemberWithRole } from "./fixtures/video-processor";

function hqSessionOnlyCookie(sessionId: string): string {
  return `alliance_hq_session=${sessionId}`;
}

function parseAllianceHqSessionId(
  setCookieHeader: string | string[] | undefined,
): string {
  const parts = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const part of parts) {
    const match = part.match(/alliance_hq_session=([^;]+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  throw new Error("Missing alliance_hq_session in Set-Cookie");
}

async function mintSessionViaBootstrap(
  request: APIRequestContext,
): Promise<string> {
  const bootstrap = await request.get("/api/auth/bootstrap?next=/", {
    maxRedirects: 0,
  });
  expect(bootstrap.status(), await bootstrap.text()).toBeGreaterThanOrEqual(300);
  expect(bootstrap.status()).toBeLessThan(400);
  return parseAllianceHqSessionId(bootstrap.headers()["set-cookie"]);
}

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/**
 * VS compliance officer tasks — bootstrap and under-privileged sessions must
 * not list, complete, waive, or change alliance minimum settings.
 */
test.describe("VS compliance RBAC", () => {
  test("bootstrap session cannot access vs-compliance APIs", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const sessionId = await mintSessionViaBootstrap(request);
    const alliance = await createNativeAlliance(sql, {
      tag: `VC${nanoid(4)}`,
      name: "VS Compliance Bootstrap Alliance",
    });

    const list = await request.get("/api/vs-compliance/events", {
      headers: { Cookie: hqSessionOnlyCookie(sessionId) },
    });
    expect(list.status(), await list.text()).toBe(403);

    const complete = await request.post(
      "/api/vs-compliance/events/e2e-missing/complete",
      { headers: { Cookie: hqSessionOnlyCookie(sessionId) } },
    );
    expect(complete.status(), await complete.text()).toBe(403);

    const waive = await request.post(
      "/api/vs-compliance/events/e2e-missing/waive",
      {
        headers: { Cookie: hqSessionOnlyCookie(sessionId) },
        data: { reason: "bootstrap should not waive" },
      },
    );
    expect(waive.status(), await waive.text()).toBe(403);

    const patch = await request.patch(
      `/api/alliance/${alliance.tag}/vs-membership-minimums`,
      {
        headers: { Cookie: hqSessionOnlyCookie(sessionId) },
        data: { minPoints: 1_000_000 },
      },
    );
    expect(patch.status(), await patch.text()).toBe(403);
  });

  test("viewer cannot access vs-compliance mutation APIs", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const baseURL = e2eBaseUrl();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `VC${nanoid(4)}`,
      name: "VS Compliance RBAC Alliance",
    });
    const viewer = await createMemberWithRole(sql, baseURL, {
      allianceId: alliance.allianceId,
      roleName: "viewer",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const list = await request.get("/api/vs-compliance/events", {
      headers: { Cookie: authCookieHeader(viewer) },
    });
    expect(list.status(), await list.text()).toBe(403);

    const patch = await request.patch(
      `/api/alliance/${alliance.tag}/vs-membership-minimums`,
      {
        headers: { Cookie: authCookieHeader(viewer) },
        data: { minPoints: 1_000_000 },
      },
    );
    expect(patch.status(), await patch.text()).toBe(403);
  });

  test("officer with members:write can list open compliance events", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const baseURL = e2eBaseUrl();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `VC${nanoid(4)}`,
      name: "VS Compliance Officer Alliance",
    });
    const officer = await createMemberWithRole(sql, baseURL, {
      allianceId: alliance.allianceId,
      roleName: "officer",
      invitedByHqUserId: maintainer.hqUserId,
    });

    const list = await request.get("/api/vs-compliance/events", {
      headers: { Cookie: authCookieHeader(officer) },
    });
    expect(list.status(), await list.text()).toBe(200);
    const body = (await list.json()) as { events: unknown[] };
    expect(Array.isArray(body.events)).toBe(true);
  });
});
