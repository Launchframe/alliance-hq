import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
} from "./fixtures/db";

test.describe("Connect-flow locale picker", () => {
  test("header language control switches locale and keeps the invite path", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const alliance = await createNativeAlliance(sql, {
      tag: `LC${nanoid(3)}`,
      name: "Locale Invite Alliance",
    });
    const { token } = await createHqInviteRow(sql, {
      allianceId: alliance.allianceId,
      email: `member-${nanoid(6)}@e2e.test`,
      roleName: "member",
      invitedByHqUserId: maintainer.hqUserId,
    });

    await page.goto(`/invite/${encodeURIComponent(token)}`);

    const language = page.getByRole("button", { name: "Language" });
    await expect(language).toBeVisible();
    await language.click();
    await page.getByRole("option", { name: "Português (Brasil)" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/pt-BR/invite/${encodeURIComponent(token)}`),
    );
    await expect(page.getByRole("button", { name: "Idioma" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Política de Privacidade" }),
    ).toBeVisible();
  });

  test("Vercel Brazil country header sends a first visit to pt-BR", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-vercel-ip-country": "BR" },
      locale: "en-US",
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      await expect(page).toHaveURL(/\/pt-BR\/?$/);
      await expect(page.getByRole("button", { name: "Idioma" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
