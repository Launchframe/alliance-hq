import { expect, test, type Page } from "@playwright/test";

import { NAV_GROUPS } from "../src/lib/nav/routes";
import {
  authCookieHeader,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";
import { createViewOnlyMember } from "./fixtures/view-only-member";

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/** Native HQ pages a view-only member should reach without a personal Ashed credential. */
const VIEW_ONLY_NATIVE_PAGES: Array<{ path: string; heading: RegExp }> = [
  { path: "/members", heading: /^members$/i },
  { path: "/commanders", heading: /commanders index/i },
  { path: "/trains", heading: /alliance train/i },
  { path: "/my-vr", heading: /^my vr$/i },
  { path: "/settings", heading: /alliance settings/i },
  { path: "/settings/discord", heading: /discord integration/i },
  { path: "/settings/trains", heading: /^trains$/i },
  { path: "/settings/team", heading: /team access/i },
  { path: "/account", heading: /^account$/i },
  { path: "/profile", heading: /^profile$/i },
  { path: "/releases", heading: /release notes/i },
];

const IFRAME_NAV_PATHS = NAV_GROUPS.flatMap((group) => group.pages)
  .filter((page) => page.kind === "iframe")
  .map((page) => page.href);

/** Read permissions the default view-only member fixture already has. */
const VIEW_ONLY_MEMBER_READ_PERMISSIONS = new Set(["members:read"]);

const PERMISSION_GATED_NAV_PATHS = NAV_GROUPS.flatMap((group) => group.pages)
  .filter(
    (page) =>
      page.requiredPermission &&
      !VIEW_ONLY_MEMBER_READ_PERMISSIONS.has(page.requiredPermission),
  )
  .map((page) => page.href)
  .filter((href) => href !== "/viral-resistance");

async function expectPageLoadsWithoutServerError(
  page: Page,
  path: string,
  heading: RegExp,
) {
  const response = await page.goto(path);
  expect(response, `No response for ${path}`).toBeTruthy();
  expect(
    response!.status(),
    `${path} returned HTTP ${response!.status()}`,
  ).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

async function expectRedirectedToMembers(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/members$/);
}

for (const operatingMode of ["native", "ashed"] as const) {
  test.describe(`View-only member pages — ${operatingMode} alliance`, () => {
    test.beforeEach(async ({ page }) => {
      const sql = getE2eSql();
      const member = await createViewOnlyMember(sql, e2eBaseUrl(), {
        operatingMode,
      });
      await page.context().addCookies(playwrightAuthCookies(member));
    });

    for (const { path, heading } of VIEW_ONLY_NATIVE_PAGES) {
      test(`loads ${path} without server error`, async ({ page }) => {
        await expectPageLoadsWithoutServerError(page, path, heading);
      });
    }

    for (const path of IFRAME_NAV_PATHS) {
      test(`redirects ${path} away from Ashed embeds`, async ({ page }) => {
        await expectRedirectedToMembers(page, path);
      });
    }

    for (const path of PERMISSION_GATED_NAV_PATHS) {
      test(`redirects ${path} when write permission is missing`, async ({
        page,
      }) => {
        await expectRedirectedToMembers(page, path);
      });
    }

    test("redirects /viral-resistance to my-vr when write permission is missing", async ({
      page,
    }) => {
      await page.goto("/viral-resistance");
      await expect(page).toHaveURL(/\/my-vr$/);
    });

    test("redirects /admin to members", async ({ page }) => {
      await page.goto("/admin");
      await expect(page).toHaveURL(/\/members$/);
    });

    test("hides upload nav link", async ({ page }) => {
      await page.goto("/members");
      await expect(
        page.getByRole("link", { name: /upload from video/i }),
      ).toHaveCount(0);
    });
  });
}

test.describe("View-only member APIs — ashed alliance without personal Ashed connect", () => {
  test("read endpoints succeed and upload is forbidden", async ({ request }) => {
    const sql = getE2eSql();
    const member = await createViewOnlyMember(sql, e2eBaseUrl(), {
      operatingMode: "ashed",
    });
    const cookie = authCookieHeader(member);

    const membersRes = await request.get("/api/members", {
      headers: { Cookie: cookie },
    });
    expect(membersRes.status(), await membersRes.text()).toBe(200);

    const trainsRes = await request.get("/api/trains/conductor/today", {
      headers: { Cookie: cookie },
    });
    expect(trainsRes.status(), await trainsRes.text()).toBe(200);

    const vrRes = await request.get("/api/vr/leaderboard", {
      headers: { Cookie: cookie },
    });
    expect(vrRes.status(), await vrRes.text()).toBe(200);

    const uploadGet = await request.get("/api/tools/video-upload", {
      headers: { Cookie: cookie },
    });
    expect(uploadGet.status()).toBe(403);

    const uploadPost = await request.post("/api/tools/video-upload", {
      headers: { Cookie: cookie },
    });
    expect(uploadPost.status()).toBe(403);
  });
});

test.describe("View-only viewer role — ashed alliance", () => {
  test("loads /members without server error", async ({ page }) => {
    const sql = getE2eSql();
    const member = await createViewOnlyMember(sql, e2eBaseUrl(), {
      operatingMode: "ashed",
      roleName: "viewer",
    });
    await page.context().addCookies(playwrightAuthCookies(member));
    await expectPageLoadsWithoutServerError(page, "/members", /^members$/i);
  });
});
