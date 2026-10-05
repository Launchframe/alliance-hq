import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  cleanupSeededActivityEvents,
  seedActivityEvent,
  type ActivitySeedRow,
} from "./fixtures/activity";
import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  playwrightAuthCookies,
  type SessionFixture,
} from "./fixtures/db";

const FUTURE = "2099-01-05T12:00:00.000000Z";

function tag(): string {
  return `A${randomUUID().replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase()}`;
}

async function memberFixture(role: "member" | "officer" = "member") {
  const sql = getE2eSql();
  const allianceTag = tag();
  const alliance = await createNativeAlliance(sql, {
    tag: allianceTag,
    name: `Activity ${allianceTag}`,
  });
  const user = await createAuthenticatedHqSession(
    sql,
    `activity-${randomUUID()}@e2e.test`,
  );
  await createAllianceMembership(sql, {
    hqUserId: user.hqUserId,
    allianceId: alliance.allianceId,
    roleName: role,
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: user.hqUserId,
  });
  await sql`
    UPDATE sessions SET current_alliance_id = ${alliance.allianceId}
    WHERE id = ${user.sessionId}
  `;
  return { user, allianceId: alliance.allianceId, tag: allianceTag };
}

async function signIn(page: Page, user: SessionFixture) {
  await page.context().addCookies(
    playwrightAuthCookies({
      sessionId: user.sessionId,
      nextAuthToken: user.nextAuthToken,
    }),
  );
}

function event(overrides: Partial<ActivitySeedRow>): ActivitySeedRow {
  return {
    id: `e2e-ui-${randomUUID()}`,
    eventKey: "thp.submitted",
    feature: "thp",
    kind: "change",
    visibilityClass: "alliance",
    occurredAt: FUTURE,
    payload: { value: "7" },
    ...overrides,
  };
}

test.afterEach(async () => {
  await cleanupSeededActivityEvents();
});

test.describe("Activity feed UI", () => {
  test("member sees own sentence and badges without actor identity", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    const row = `e2e-ui-own-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        actorDisplayName: "E2E Member",
        actorHqRole: "member",
        actorGameRank: "R4",
        channel: "discord",
        method: "screenshot",
        payload: { value: "123456789" },
      }),
    );

    await signIn(page, user);
    await page.goto("/activity");

    await expect(
      page.getByRole("heading", { name: "Activity" }),
    ).toBeVisible();
    const item = page.getByTestId(`activity-item-${row}`);
    await expect(item).toContainText(
      "You submitted a new THP of 123,456,789",
    );
    await expect(item).toContainText("Discord");
    await expect(item).toContainText("Screenshot OCR");
    await expect(item.getByText("R4", { exact: true })).toHaveCount(0);
    await expect(item.getByText("Member", { exact: true })).toHaveCount(0);
    await expect(item.getByText("E2E Member")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Personal", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Global", exact: true }),
    ).toHaveCount(0);
  });

  test("officer alliance tab shows snapshot badges and hides private rows", async ({
    page,
  }) => {
    const { user, allianceId, tag: allianceTag } = await memberFixture("officer");
    const promoted = `e2e-ui-prom-${randomUUID()}`;
    const privateRow = `e2e-ui-priv-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: promoted,
        eventKey: "member.promoted",
        feature: "members",
        allianceId,
        allianceTag,
        actorDisplayName: "Redd",
        actorHqRole: "owner",
        actorGameRank: "R5",
        channel: "web",
        historical: true,
        payload: { member: "Jam", fromRank: "R3", toRank: "R4" },
      }),
    );
    await seedActivityEvent(
      event({
        id: privateRow,
        eventKey: "note.updated",
        feature: "notes",
        visibilityClass: "private",
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        payload: {},
      }),
    );

    await signIn(page, user);
    await page.goto("/activity?scope=alliance");

    await expect(
      page.getByRole("link", { name: "Personal", exact: true }),
    ).toBeVisible();
    const allianceTab = page.getByRole("link", {
      name: "Alliance",
      exact: true,
    });
    await expect(allianceTab).toBeVisible();
    await expect(allianceTab).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: "Global", exact: true }),
    ).toHaveCount(0);

    const item = page.getByTestId(`activity-item-${promoted}`);
    await expect(item).toContainText("Redd promoted Jam from R3 to R4");
    await expect(item.locator("[title='HQ role']")).toHaveText("Owner");
    await expect(item.locator("[title='Game rank']")).toHaveText("R5");
    await expect(item).toContainText("Web");
    await expect(item).toContainText("Historical activity");
    await expect(page.getByTestId(`activity-item-${privateRow}`)).toHaveCount(
      0,
    );

    await page.goto("/activity?scope=global");
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);
  });

  test("maintainer global feed prefixes alliance context and admin link redirects", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const row = `e2e-ui-glob-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        eventKey: "scores.discarded",
        feature: "scores",
        allianceId: `e2e-ui-all-${randomUUID()}`,
        serverNumber: "1203",
        allianceTag: "LFgo",
        allianceName: "Launchframe",
        actorDisplayName: "BOGGLE",
        actorHqRole: "officer",
        actorGameRank: "R4",
        originalHqUserId: `e2e-actor-${randomUUID()}`,
        channel: "web",
        payload: { affected: 2, completed: 1 },
      }),
    );

    await signIn(page, maintainer);
    await page.goto("/activity?scope=global");

    const item = page.getByTestId(`activity-item-${row}`);
    await expect(item).toContainText(
      "1203 [LFgo] BOGGLE discarded VS Performance scores",
    );
    await expect(item.locator("[title='HQ role']")).toHaveText("Officer");
    await expect(item.locator("[title='Game rank']")).toHaveText("R4");
    await expect(item).toContainText("Web");
    await expect(
      page.getByRole("link", { name: "Global", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("link", { name: "Personal", exact: true }),
    ).toBeVisible();

    await page.goto("/admin/activity");
    await expect(page).toHaveURL(/\/activity\?scope=global/);
    await expect(item).toContainText("1203 [LFgo] BOGGLE");
  });

  test("pt-BR feed localizes sentence, timezone, and stays readable in both themes", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const { user, allianceId } = await memberFixture();
    await sql`
      UPDATE hq_users SET timezone = 'America/New_York' WHERE id = ${user.hqUserId}
    `;
    const row = `e2e-ui-ptbr-${randomUUID()}`;
    const longRow = `e2e-ui-ptbr-long-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        occurredAt: "2099-01-05T02:00:00.000000Z",
        channel: "web",
        payload: { value: "123456789012345678901234567890" },
      }),
    );
    await seedActivityEvent(
      event({
        id: longRow,
        eventKey: "member.promoted",
        feature: "members",
        descriptor: "promoted",
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        occurredAt: "2099-01-04T12:00:00.000000Z",
        actorDisplayName: `E2E-${"VeryLongActorName".repeat(6)}`,
        payload: {
          member: `M${"x".repeat(80)}`,
          fromRank: "R3",
          toRank: "R4",
        },
      }),
    );

    await signIn(page, user);
    await page.goto("/pt-BR/activity");

    const heading = page.getByRole("heading", { name: "Atividade" });
    await expect(heading).toBeVisible();
    const item = page.getByTestId(`activity-item-${row}`);
    const expectedValue = new Intl.NumberFormat("pt-BR").format(
      BigInt("123456789012345678901234567890"),
    );
    await expect(item).toContainText(
      `Você enviou um novo THP de ${expectedValue}`,
    );

    const expectedLocal = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).format(new Date("2099-01-05T02:00:00.000000Z"));
    await expect(item.locator("time")).toContainText(expectedLocal);
    await expect(item.locator("time")).toHaveAttribute(
      "dateTime",
      "2099-01-05T02:00:00.000000Z",
    );

    const luminance = async () =>
      page.evaluate(() => {
        const rgb = getComputedStyle(
          document.querySelector("h1")!,
        ).color.match(/\d+/g)!;
        const [r, g, b] = rgb.map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveClass(/(?:^|\s)light(?:\s|$)/);
    const lightLum = await luminance();
    expect(Number.isFinite(lightLum)).toBe(true);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/(?:^|\s)dark(?:\s|$)/);
    const darkLum = await luminance();
    expect(darkLum).toBeGreaterThan(lightLum);
    await page.emulateMedia({ colorScheme: "light" });

    await expect(page.getByTestId(`activity-item-${longRow}`)).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    let focusedTag = "";
    for (let i = 0; i < 20 && focusedTag === ""; i++) {
      await page.keyboard.press("Tab");
      focusedTag = await page.evaluate(() => {
        const tagName = document.activeElement?.tagName ?? "";
        return ["A", "BUTTON", "INPUT", "SUMMARY"].includes(tagName)
          ? tagName
          : "";
      });
    }
    expect(focusedTag).not.toBe("");
  });

  test("paginates past fifty events appending without duplicates", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    for (let i = 0; i < 60; i++) {
      await seedActivityEvent(
        event({
          id: `e2e-ui-page-${String(i).padStart(2, "0")}-${randomUUID()}`,
          allianceId,
          occurredAt: `2099-01-05T12:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i).padStart(2, "0")}.000000Z`,
          personalOwnerHqUserId: user.hqUserId,
          originalHqUserId: user.hqUserId,
          payload: { value: String(1000 + i) },
        }),
      );
    }

    await signIn(page, user);
    await page.goto("/activity");

    const items = page.locator("[data-testid^='activity-item-']");
    await expect(items).toHaveCount(50);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(items).toHaveCount(60);
    const ids = await items.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")),
    );
    expect(new Set(ids).size).toBe(60);
  });

  test("channel, category, and date filters narrow the feed and clear restores", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    const webRow = `e2e-ui-web-${randomUUID()}`;
    const discordRow = `e2e-ui-disc-${randomUUID()}`;
    const noteRow = `e2e-ui-note-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: webRow,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        channel: "web",
        occurredAt: "2099-02-10T12:00:00.000000Z",
      }),
    );
    await seedActivityEvent(
      event({
        id: discordRow,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        channel: "discord",
        occurredAt: "2099-02-11T12:00:00.000000Z",
      }),
    );
    await seedActivityEvent(
      event({
        id: noteRow,
        eventKey: "note.updated",
        feature: "notes",
        visibilityClass: "private",
        personalOwnerHqUserId: user.hqUserId,
        channel: "web",
        occurredAt: "2099-03-01T12:00:00.000000Z",
        payload: {},
      }),
    );

    await signIn(page, user);
    await page.goto("/activity");
    const items = page.locator("[data-testid^='activity-item-']");
    await expect(items).toHaveCount(3);

    await page.getByRole("button", { name: "Channel", exact: true }).click();
    await page.getByRole("option", { name: "Discord" }).click();
    await expect(items).toHaveCount(1);
    await expect(page.getByTestId(`activity-item-${discordRow}`)).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(items).toHaveCount(3);

    await page.getByRole("button", { name: "Category" }).click();
    await page.getByRole("option", { name: "Notes" }).click();
    await expect(items).toHaveCount(1);
    await expect(page.getByTestId(`activity-item-${noteRow}`)).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(items).toHaveCount(3);

    await page
      .getByRole("button", { name: "Activity type", exact: true })
      .click();
    await page.getByRole("option", { name: "Changes" }).click();
    await expect(items).toHaveCount(3);
    await page
      .getByRole("button", { name: "Activity type", exact: true })
      .click();
    await page.getByRole("option", { name: "Usage" }).click();
    await expect(items).toHaveCount(0);
    await expect(
      page.getByText("No activity matches these filters."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(items).toHaveCount(3);

    await page.locator("#activity-date-from").fill("2099-02-11");
    await expect(items).toHaveCount(2);
    await page.locator("#activity-date-to").fill("2099-02-11");
    await expect(items).toHaveCount(1);
    await expect(page.getByTestId(`activity-item-${discordRow}`)).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(items).toHaveCount(3);
  });

  test("user, alliance, and server lookups query the server without leaking ids", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const allianceRow = `e2e-ui-all-${randomUUID()}`;
    const serverRow = `e2e-ui-srv-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: allianceRow,
        allianceId: `e2e-ui-tenant-${randomUUID()}`,
        serverNumber: "1203",
        allianceTag: "LFgo",
        allianceName: "Launchframe",
        actorDisplayName: "BOGGLE",
        originalHqUserId: `e2e-actor-${randomUUID()}`,
        channel: "web",
      }),
    );
    await seedActivityEvent(
      event({
        id: serverRow,
        allianceId: `e2e-ui-tenant-${randomUUID()}`,
        serverNumber: "1203",
        actorDisplayName: "SKATER",
        originalDiscordUserId: `e2e-disc-${randomUUID()}`,
        actorKind: "discord",
        channel: "discord",
      }),
    );

    await signIn(page, maintainer);
    await page.goto("/activity?scope=global");

    const userSelect = page.locator("button[aria-label='User']");
    await userSelect.click();
    const userSearch = page.locator("input[type='search']");
    await expect(userSearch).toBeVisible();
    const actorResponse = page.waitForResponse(
      (res) =>
        res.url().includes("view=filters") && res.url().includes("q=BOGG"),
    );
    await userSearch.fill("BOGG");
    await actorResponse;
    const boggleOption = page.getByRole("option", { name: "BOGGLE" });
    await expect(boggleOption).toBeVisible();
    const optionTexts = await page
      .locator("[role='option']")
      .allTextContents();
    expect(optionTexts.every((text) => !text.includes("hq:"))).toBe(true);
    await boggleOption.click();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(1);

    await page.getByRole("button", { name: "Clear filters" }).click();

    await page.locator("button[aria-label='Alliance']").click();
    const allianceResponse = page.waitForResponse(
      (res) =>
        res.url().includes("view=filters") && res.url().includes("q=LFgo"),
    );
    await page.locator("input[type='search']").fill("LFgo");
    await allianceResponse;
    const allianceOption = page.getByRole("option", {
      name: "1203 [LFgo] Launchframe",
    });
    await expect(allianceOption).toBeVisible();
    await page.keyboard.press("Escape");

    await page.locator("button[aria-label='Server']").click();
    const serverResponse = page.waitForResponse(
      (res) =>
        res.url().includes("view=filters") && res.url().includes("q=1203"),
    );
    await page.locator("input[type='search']").fill("1203");
    await serverResponse;
    await expect(
      page.getByRole("option", { name: "1203", exact: true }),
    ).toBeVisible();
  });

  test("empty and no-match states use distinct copy", async ({ page }) => {
    const { user } = await memberFixture();
    await signIn(page, user);
    await page.goto("/activity");
    await expect(page.getByText("No activity yet.")).toBeVisible();

    await page.getByRole("button", { name: "Channel", exact: true }).click();
    await page.getByRole("option", { name: "Discord" }).click();
    await expect(
      page.getByText("No activity matches these filters."),
    ).toBeVisible();
    await expect(page.getByText("No activity yet.")).toHaveCount(0);
  });

  test("failed refresh offers retry and forbidden clears every row", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    const row = `e2e-ui-err-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
      }),
    );
    await signIn(page, user);
    await page.goto("/activity");
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();

    await page.route("**/api/activity/personal**", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Couldn't load activity. Try again.",
          errorKey: "activity.loadFailed",
          code: "internal",
        }),
      }),
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "load activity. Try again" }),
    ).toBeVisible();

    await page.unroute("**/api/activity/personal**");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByText("load activity. Try again"),
    ).toHaveCount(0);
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();

    await page.route("**/api/activity/personal**", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Your access has changed. Refresh to continue.",
          errorKey: "activity.accessChanged",
          code: "forbidden",
        }),
      }),
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your access has changed. Refresh to continue." }),
    ).toBeVisible();
    await expect(page.getByTestId(`activity-item-${row}`)).toHaveCount(0);
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);
  });

  test("head poll surfaces new activity without disturbing the list", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    const row = `e2e-ui-poll-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
      }),
    );

    await page.clock.install();
    await signIn(page, user);
    await page.goto("/activity");
    const item = page.getByTestId(`activity-item-${row}`);
    await expect(item).toBeVisible();

    let headRequests = 0;
    await page.route("**/api/activity/**", async (route) => {
      if (route.request().url().includes("view=head")) {
        headRequests += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            head: { id: "e2e-fake-new-head", occurredAt: FUTURE },
            scope: "personal",
            scopeFence: JSON.stringify([user.hqUserId, allianceId]),
            allowedScopes: ["personal"],
          }),
        });
      }
      return route.continue();
    });

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        get: () => true,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        get: () => "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(35_000);
    expect(headRequests).toBe(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        get: () => false,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        get: () => "visible",
        configurable: true,
      });
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("New activity available")).toBeVisible();
    expect(headRequests).toBe(1);
    await expect(item).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(1);

    await page.unroute("**/api/activity/**");
    await page.getByRole("button", { name: "Show new activity" }).click();
    await expect(page.getByText("New activity available")).toHaveCount(0);
    await expect(item).toBeVisible();
  });

  test("stale head and page responses are ignored after a filter change", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    const webRow = `e2e-ui-stale-web-${randomUUID()}`;
    const discordRow = `e2e-ui-stale-disc-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: webRow,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        channel: "web",
      }),
    );
    await seedActivityEvent(
      event({
        id: discordRow,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        channel: "discord",
        occurredAt: "2099-01-04T12:00:00.000000Z",
      }),
    );

    await signIn(page, user);
    await page.goto("/activity");
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(2);

    const held: Array<() => void> = [];
    let headHeld = false;
    let staleArmed = true;
    const fence = `["${user.hqUserId}","${allianceId}"]`;
    await page.route("**/api/activity/**", async (route) => {
      const url = route.request().url();
      if (staleArmed && url.includes("view=head") && !headHeld) {
        headHeld = true;
        await new Promise<void>((resolve) => {
          held.push(resolve);
        });
        try {
          return await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              head: { id: "e2e-fake-new-head", occurredAt: FUTURE },
              scope: "personal",
              scopeFence: fence,
              allowedScopes: ["personal"],
            }),
          });
        } catch {
          return;
        }
      }
      if (staleArmed && url.includes("view=page") && !url.includes("cursor")) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      return route.continue();
    });

    try {
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          get: () => false,
          configurable: true,
        });
        Object.defineProperty(document, "visibilityState", {
          get: () => "visible",
          configurable: true,
        });
      });
      await expect
        .poll(
          async () => {
            await page.evaluate(() =>
              window.dispatchEvent(new Event("focus")),
            );
            return headHeld;
          },
          { timeout: 10_000 },
        )
        .toBe(true);

      await page.getByRole("button", { name: "Refresh" }).click();
      await page.getByRole("button", { name: "Channel", exact: true }).click();
      await page.getByRole("option", { name: "Discord" }).click();
    } finally {
      staleArmed = false;
      for (const release of held.splice(0)) release();
    }

    await expect(page.getByTestId(`activity-item-${discordRow}`)).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(1);
    await expect(page.getByTestId(`activity-item-${webRow}`)).toHaveCount(0);
    await expect(page.getByText("New activity available")).toHaveCount(0);
  });

  test("fence mismatch after alliance switch clears rows and shows access changed", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const { user, allianceId } = await memberFixture("officer");
    const row = `e2e-ui-fence-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
      }),
    );

    await signIn(page, user);
    await page.goto("/activity?scope=alliance");
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();

    const second = await createNativeAlliance(sql, {
      tag: tag(),
      name: "Other Alliance",
    });
    await sql`
      UPDATE sessions SET current_alliance_id = ${second.allianceId}
      WHERE id = ${user.sessionId}
    `;

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your access has changed. Refresh to continue." }),
    ).toBeVisible();
    await expect(page.getByTestId(`activity-item-${row}`)).toHaveCount(0);
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);
  });

  test("access changed refresh reloads and recovers the current context", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const { user, allianceId } = await memberFixture();
    const second = await createNativeAlliance(sql, {
      tag: tag(),
      name: "Recovery Alliance",
    });
    await createAllianceMembership(sql, {
      hqUserId: user.hqUserId,
      allianceId: second.allianceId,
      roleName: "officer",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: second.allianceId,
      hqUserId: user.hqUserId,
    });
    const row = `e2e-ui-recover-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
      }),
    );

    await signIn(page, user);
    await page.goto("/activity");
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Alliance", exact: true }),
    ).toHaveCount(0);

    await sql`
      UPDATE sessions SET current_alliance_id = ${second.allianceId}
      WHERE id = ${user.sessionId}
    `;

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your access has changed. Refresh to continue." }),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page.getByRole("heading", { name: "Activity" }),
    ).toBeVisible();
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your access has changed. Refresh to continue." }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Alliance", exact: true }),
    ).toBeVisible();
  });

  test("metadata denial wins over a held refresh response", async ({ page }) => {
    const { user, allianceId } = await memberFixture("officer");
    const row = `e2e-ui-meta-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        actorDisplayName: "Redd",
      }),
    );

    await signIn(page, user);
    await page.goto("/activity?scope=alliance");
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();

    await page.evaluate(() => {
      const w = window as unknown as {
        __feedHold: boolean;
        __feedHeld: { url: string; resolve: (res: Response) => void }[];
        __feedFetch: typeof window.fetch;
      };
      w.__feedHold = true;
      w.__feedHeld = [];
      w.__feedFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!w.__feedHold || !url.includes("/api/activity/")) {
          return w.__feedFetch(input, init);
        }
        if (url.includes("q=")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                error: "Your access has changed. Refresh to continue.",
                errorKey: "activity.accessChanged",
                code: "forbidden",
              }),
              {
                status: 403,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }
        return new Promise<Response>((resolve) => {
          w.__feedHeld.push({ url, resolve });
        });
      };
    });

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.locator("button[aria-label='User']").click();
    await page.locator("input[type='search']").fill("redd");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your access has changed. Refresh to continue." }),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);

    const fence = `["${user.hqUserId}","${allianceId}"]`;
    await page.evaluate(
      ({ heldFence, heldRow }) => {
        const w = window as unknown as {
          __feedHeld: { url: string; resolve: (res: Response) => void }[];
        };
        for (const held of w.__feedHeld.splice(0)) {
          const body = held.url.includes("view=filters")
            ? {
                options: {
                  actors: [],
                  alliances: [],
                  servers: [],
                  categories: [],
                  channels: [],
                  kinds: [],
                },
                scope: "alliance",
                scopeFence: heldFence,
                allowedScopes: ["personal", "alliance"],
              }
            : held.url.includes("view=head")
              ? {
                  head: null,
                  scope: "alliance",
                  scopeFence: heldFence,
                  allowedScopes: ["personal", "alliance"],
                }
              : {
                  items: [
                    {
                      id: heldRow,
                      occurredAt: "2099-01-05T12:00:00.000000Z",
                      eventKey: "thp.submitted",
                      feature: "thp",
                      kind: "change",
                      descriptor: "thpSubmitted",
                      resource: null,
                      values: { value: "7" },
                      details: {},
                      actor: null,
                      alliance: null,
                      channel: "web",
                      method: "manual",
                      severity: "update",
                      historical: false,
                      historicalCurrentLabels: false,
                    },
                  ],
                  nextCursor: null,
                  head: null,
                  scope: "alliance",
                  scopeFence: heldFence,
                  allowedScopes: ["personal", "alliance"],
                };
          held.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
      },
      { heldFence: fence, heldRow: row },
    );
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Your access has changed. Refresh to continue." }),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);
    await expect(page.locator("button[aria-label='User']")).toHaveCount(0);
  });

  test("invalid date range blocks requests and ignores held responses", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    const row = `e2e-ui-invdate-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
        occurredAt: "2099-01-03T12:00:00.000000Z",
      }),
    );

    await signIn(page, user);
    await page.goto("/activity");
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();

    await page.evaluate(() => {
      const w = window as unknown as {
        __feedHold: boolean;
        __feedHeld: { url: string; resolve: (res: Response) => void }[];
        __feedUrls: string[];
        __feedFetch: typeof window.fetch;
      };
      w.__feedHold = true;
      w.__feedHeld = [];
      w.__feedUrls = [];
      w.__feedFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/api/activity/")) w.__feedUrls.push(url);
        if (
          !w.__feedHold ||
          !url.includes("/api/activity/") ||
          !url.includes("view=page") ||
          url.includes("cursor")
        ) {
          return w.__feedFetch(input, init);
        }
        return new Promise<Response>((resolve) => {
          w.__feedHeld.push({ url, resolve });
        });
      };
    });

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.locator("#activity-date-from").fill("2099-01-10");
    await page.locator("#activity-date-to").fill("2099-01-01");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "load activity. Try again" }),
    ).toBeVisible();
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);

    const fence = `["${user.hqUserId}","${allianceId}"]`;
    await page.evaluate(
      ({ heldFence, heldRow }) => {
        const w = window as unknown as {
          __feedHeld: { url: string; resolve: (res: Response) => void }[];
        };
        for (const held of w.__feedHeld.splice(0)) {
          held.resolve(
            new Response(
              JSON.stringify({
                items: [
                  {
                    id: heldRow,
                    occurredAt: "2099-01-03T12:00:00.000000Z",
                    eventKey: "thp.submitted",
                    feature: "thp",
                    kind: "change",
                    descriptor: "thpSubmitted",
                    resource: null,
                    values: { value: "7" },
                    details: {},
                    actor: null,
                    alliance: null,
                    channel: "web",
                    method: "manual",
                    severity: "update",
                    historical: false,
                    historicalCurrentLabels: false,
                  },
                ],
                nextCursor: null,
                head: null,
                scope: "personal",
                scopeFence: heldFence,
                allowedScopes: ["personal"],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
          );
        }
      },
      { heldFence: fence, heldRow: row },
    );
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );
    await expect(
      page.locator("[data-testid^='activity-item-']"),
    ).toHaveCount(0);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "load activity. Try again" }),
    ).toBeVisible();

    const requestsBefore = await page.evaluate(
      () => (window as unknown as { __feedUrls: string[] }).__feedUrls.length,
    );

    const headRequestsBefore = await page.evaluate(
      () =>
        (window as unknown as { __feedUrls: string[] }).__feedUrls.filter(
          (url) => url.includes("view=head"),
        ).length,
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        get: () => false,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        get: () => "visible",
        configurable: true,
      });
      window.dispatchEvent(new Event("focus"));
    });
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );
    const headRequestsAfter = await page.evaluate(
      () =>
        (window as unknown as { __feedUrls: string[] }).__feedUrls.filter(
          (url) => url.includes("view=head"),
        ).length,
    );
    expect(headRequestsAfter).toBe(headRequestsBefore);
    await page.locator("button[aria-label='Alliance']").click();
    await page.locator("input[type='search']").fill("Launch");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("button", { name: "Try again" }).click();
    await page.waitForTimeout(200);
    const requestsAfter = await page.evaluate(
      () => (window as unknown as { __feedUrls: string[] }).__feedUrls.length,
    );
    expect(requestsAfter).toBe(requestsBefore);
    await expect(page.getByText("New activity available")).toHaveCount(0);

    await page.evaluate(() => {
      (window as unknown as { __feedHold: boolean }).__feedHold = false;
    });
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();
  });

  test("load more failure anchors retry at the list bottom", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    for (let i = 0; i < 60; i++) {
      await seedActivityEvent(
        event({
          id: `e2e-ui-more-${String(i).padStart(2, "0")}-${randomUUID()}`,
          allianceId,
          occurredAt: `2099-01-05T12:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i).padStart(2, "0")}.000000Z`,
          personalOwnerHqUserId: user.hqUserId,
          originalHqUserId: user.hqUserId,
          payload: { value: String(1000 + i) },
        }),
      );
    }

    await signIn(page, user);
    await page.goto("/activity");
    const items = page.locator("[data-testid^='activity-item-']");
    await expect(items).toHaveCount(50);

    let releaseRefresh: (() => void) | null = null;
    let refreshHeld = false;
    let failNextMore = true;
    let spoofNextMoreHead = false;
    await page.route("**/api/activity/personal**", async (route) => {
      const url = route.request().url();
      if (
        url.includes("view=page") &&
        !url.includes("cursor") &&
        !refreshHeld
      ) {
        refreshHeld = true;
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        });
        try {
          return await route.continue();
        } catch {
          return;
        }
      }
      if (url.includes("view=page") && url.includes("cursor")) {
        if (failNextMore) {
          failNextMore = false;
          return route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Couldn’t load activity. Try again.",
              errorKey: "activity.loadFailed",
              code: "internal",
            }),
          });
        }
        if (spoofNextMoreHead) {
          const res = await route.fetch();
          const body = (await res.json()) as { head: unknown };
          body.head = { id: "e2e-bogus-more-head", occurredAt: FUTURE };
          return route.fulfill({ response: res, json: body });
        }
      }
      return route.continue();
    });

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("button", { name: "Load more" })).toBeDisabled();
    await expect.poll(() => releaseRefresh !== null).toBe(true);
    releaseRefresh!();
    await expect(page.getByRole("button", { name: "Load more" })).toBeEnabled();

    spoofNextMoreHead = true;
    await page.getByRole("button", { name: "Load more" }).click();
    const bottomAlert = page
      .getByRole("alert")
      .filter({ hasText: "load activity. Try again" });
    await expect(bottomAlert).toBeVisible();
    await expect(bottomAlert).toBeInViewport();
    await expect(items).toHaveCount(50);

    await page.getByRole("button", { name: "Try again" }).click();
    await expect(items).toHaveCount(60);
    const ids = await items.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")),
    );
    expect(new Set(ids).size).toBe(60);

    await page.unroute("**/api/activity/personal**");
    const headResponse = page.waitForResponse(
      (res) => res.url().includes("view=head"),
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        get: () => false,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        get: () => "visible",
        configurable: true,
      });
      window.dispatchEvent(new Event("focus"));
    });
    await headResponse;
    await expect(page.getByText("New activity available")).toHaveCount(0);
  });

  test("poll failure surfaces a quiet toolbar error without scrolling", async ({
    page,
  }) => {
    const { user, allianceId } = await memberFixture();
    const row = `e2e-ui-pollerr-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: row,
        allianceId,
        personalOwnerHqUserId: user.hqUserId,
        originalHqUserId: user.hqUserId,
      }),
    );

    await signIn(page, user);
    await page.goto("/activity");
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();

    let failedHeads = 0;
    await page.route("**/api/activity/personal**", (route) => {
      const url = route.request().url();
      if (url.includes("view=head")) {
        failedHeads += 1;
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Couldn’t load activity. Try again.",
            errorKey: "activity.loadFailed",
            code: "internal",
          }),
        });
      }
      return route.continue();
    });

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        get: () => false,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        get: () => "visible",
        configurable: true,
      });
    });
    let lastDispatch = 0;
    await expect
      .poll(async () => {
        if (Date.now() - lastDispatch > 1_500) {
          lastDispatch = Date.now();
          await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        }
        return failedHeads;
      }, { timeout: 15_000 })
      .toBeGreaterThan(0);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "load activity. Try again" }),
    ).toBeVisible();
    await expect(page.getByTestId(`activity-item-${row}`)).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test("lookup refetches unfiltered options and ignores a late search response", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const allianceRow = `e2e-ui-late-${randomUUID()}`;
    const secondRow = `e2e-ui-late2-${randomUUID()}`;
    await seedActivityEvent(
      event({
        id: allianceRow,
        allianceId: `e2e-ui-tenant-${randomUUID()}`,
        serverNumber: "1203",
        allianceTag: "LFgo",
        allianceName: "Launchframe",
        actorDisplayName: "BOGGLE",
        originalHqUserId: `e2e-actor-${randomUUID()}`,
        channel: "web",
      }),
    );
    await seedActivityEvent(
      event({
        id: secondRow,
        allianceId: `e2e-ui-tenant-${randomUUID()}`,
        serverNumber: "1203",
        actorDisplayName: "SKATER",
        originalDiscordUserId: `e2e-disc-${randomUUID()}`,
        actorKind: "discord",
        channel: "discord",
      }),
    );

    await signIn(page, maintainer);
    await page.goto("/activity?scope=global");

    let releaseBog: (() => void) | null = null;
    await page.route("**/api/admin/activity**", async (route) => {
      const url = route.request().url();
      if (url.includes("view=filters") && url.includes("q=BOG")) {
        await new Promise<void>((resolve) => {
          releaseBog = resolve;
        });
        try {
          return await route.continue();
        } catch {
          return;
        }
      }
      return route.continue();
    });

    await page.locator("button[aria-label='User']").click();
    const search = page.locator("input[type='search']");
    await expect(search).toBeVisible();
    await search.fill("BOG");
    await expect
      .poll(() => releaseBog !== null, { timeout: 5_000 })
      .toBe(true);

    const blankResponse = page.waitForResponse(
      (res) =>
        res.url().includes("view=filters") && !res.url().includes("q="),
      { timeout: 5_000 },
    );
    await search.fill("");
    await blankResponse;
    await expect(
      page.getByRole("option", { name: "BOGGLE" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "SKATER" }),
    ).toBeVisible();

    releaseBog!();
    await page.waitForTimeout(200);
    await expect(
      page.getByRole("option", { name: "BOGGLE" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "SKATER" }),
    ).toBeVisible();
  });
});
