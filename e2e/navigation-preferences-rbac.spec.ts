import { expect, test, type APIRequestContext } from "@playwright/test";

import { getE2eSql } from "./fixtures/db";

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

test.describe("Navigation preferences API RBAC", () => {
  test("bootstrap session cannot read or mutate navigation preferences", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const sessionId = await mintSessionViaBootstrap(request);

    const [row] = await sql`
      SELECT hq_user_id FROM sessions WHERE id = ${sessionId}
    `;
    expect(row?.hq_user_id).toBeNull();

    const cookie = hqSessionOnlyCookie(sessionId);

    const getRes = await request.get("/api/account/navigation-preferences", {
      headers: { Cookie: cookie },
    });
    expect(getRes.status(), await getRes.text()).toBe(401);

    const postRes = await request.post("/api/account/navigation-preferences", {
      headers: { Cookie: cookie, "content-type": "application/json" },
      data: { destinationId: "members" },
    });
    expect(postRes.status(), await postRes.text()).toBe(401);

    const patchRes = await request.patch("/api/account/navigation-preferences", {
      headers: { Cookie: cookie, "content-type": "application/json" },
      data: { showAshedPages: false },
    });
    expect(patchRes.status(), await patchRes.text()).toBe(401);

    const putRes = await request.put("/api/account/navigation-preferences", {
      headers: { Cookie: cookie, "content-type": "application/json" },
      data: { destinationId: "members" },
    });
    expect(putRes.status(), await putRes.text()).toBe(401);
  });
});
