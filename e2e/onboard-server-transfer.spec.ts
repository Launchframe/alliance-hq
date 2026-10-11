import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  acceptInviteViaApi,
  createAllianceRosterMember,
  createHqInviteRow,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  linkNativeAllianceToGameServer,
  playwrightAuthCookies,
} from "./fixtures/db";

type Sql = ReturnType<typeof getE2eSql>;
type Page = import("@playwright/test").Page;

function e2eBaseUrl(): string {
  return process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5176";
}

/** Bypass UIDs: `1234567890` + server → `E2eNativeOwner` positioned on that server. */
const BYPASS_NAME = "E2eNativeOwner";
const PREVIOUS_HOME_SERVER = 1211;

async function seedInvitedTransfer(
  sql: Sql,
  input: { allianceServer: number; gameUid: string },
) {
  await sql`DELETE FROM commanders WHERE game_uid = ${input.gameUid}`;
  const maintainer = await createPlatformMaintainerSession(sql);
  const alliance = await createNativeAlliance(sql, {
    tag: `ST${nanoid(3)}`,
    name: "Server Transfer Alliance",
  });
  await linkNativeAllianceToGameServer(sql, alliance.allianceId, input.allianceServer);
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: BYPASS_NAME,
  });

  const now = new Date();
  await sql`
    INSERT INTO commanders (
      id, primary_name, primary_name_normalized, game_uid, game_server_number,
      created_at, updated_at
    ) VALUES (
      ${nanoid(16)}, ${BYPASS_NAME}, ${BYPASS_NAME.toLowerCase()}, ${input.gameUid},
      ${PREVIOUS_HOME_SERVER}, ${now}, ${now}
    )
  `;

  const email = `transfer-${nanoid(6)}@e2e.test`.toLowerCase();
  const { token } = await createHqInviteRow(sql, {
    allianceId: alliance.allianceId,
    email,
    roleName: "officer",
    invitedByHqUserId: maintainer.hqUserId,
  });
  const accepted = await acceptInviteViaApi(sql, e2eBaseUrl(), token, email);
  return { alliance, accepted, email };
}

function isMemberLinkSubmitResponse(res: import("@playwright/test").Response) {
  const pathname = new URL(res.url()).pathname;
  return (
    pathname.endsWith("/api/member-link") &&
    res.request().method() === "POST"
  );
}

async function submitUidThenConfirm(page: Page, uid: string) {
  await page.goto("/onboard");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.getByLabel(/player uid/i).fill(uid);
  await page.getByRole("button", { name: /link my commander/i }).click();
  const confirm = page.getByRole("button", { name: /yes, that's me/i });
  await expect(confirm).toBeVisible();
  const linkResponse = page.waitForResponse(isMemberLinkSubmitResponse);
  await confirm.click();
  const response = await linkResponse;
  expect(response.ok()).toBe(true);
  return (await response.json()) as { outcome?: string };
}

test.describe("Member-link server transfer", () => {
  test("invited commander confirms a transfer and links on the new server", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const allianceServer = 1287;
    const gameUid = `1234567890${allianceServer}`;
    const { alliance, accepted, email } = await seedInvitedTransfer(sql, {
      allianceServer,
      gameUid,
    });

    try {
      await page.context().addCookies(
        playwrightAuthCookies({ ...accepted, email }),
      );
      const body = await submitUidThenConfirm(page, gameUid);
      expect(body.outcome).toBe("confirm_server_transfer");
      await expect(
        page.getByRole("heading", { name: /did you transfer servers/i }),
      ).toBeVisible();

      const linkResponse = page.waitForResponse(isMemberLinkSubmitResponse);
      await page
        .getByRole("button", {
          name: new RegExp(`yes, i transferred .*server ${allianceServer}`, "i"),
        })
        .click();
      const linked = (await (await linkResponse).json()) as { outcome?: string };
      expect(linked.outcome).toBe("linked");

      const [commander] = await sql<{ game_server_number: number | null }[]>`
        SELECT game_server_number FROM commanders WHERE game_uid = ${gameUid}
      `;
      expect(commander?.game_server_number).toBe(allianceServer);

      const [link] = await sql<{ hq_user_id: string }[]>`
        SELECT hq_user_id FROM hq_member_links
        WHERE alliance_id = ${alliance.allianceId} AND hq_user_id = ${accepted.hqUserId}
      `;
      expect(link?.hq_user_id).toBe(accepted.hqUserId);

      const [audit] = await sql<{ metadata: Record<string, unknown> | null }[]>`
        SELECT metadata FROM audit_log
        WHERE alliance_id = ${alliance.allianceId}
          AND action = 'member_link.server_transfer_confirmed'
        LIMIT 1
      `;
      expect(audit).toBeDefined();
      expect(JSON.stringify(audit?.metadata)).not.toContain(gameUid);
    } finally {
      await sql`DELETE FROM commanders WHERE game_uid = ${gameUid}`;
    }
  });

  test("declining the transfer shows wrong-server guidance without linking", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const allianceServer = 1284;
    const gameUid = `1234567890${allianceServer}`;
    const { alliance, accepted, email } = await seedInvitedTransfer(sql, {
      allianceServer,
      gameUid,
    });

    try {
      await page.context().addCookies(
        playwrightAuthCookies({ ...accepted, email }),
      );
      const body = await submitUidThenConfirm(page, gameUid);
      expect(body.outcome).toBe("confirm_server_transfer");

      await page
        .getByRole("button", {
          name: new RegExp(`no, my home is still server ${PREVIOUS_HOME_SERVER}`, "i"),
        })
        .click();
      await expect(
        page.getByRole("heading", { name: /wrong state server/i }),
      ).toBeVisible();

      const [link] = await sql<{ id: string }[]>`
        SELECT id FROM hq_member_links
        WHERE alliance_id = ${alliance.allianceId} AND hq_user_id = ${accepted.hqUserId}
      `;
      expect(link).toBeUndefined();
      const [commander] = await sql<{ game_server_number: number | null }[]>`
        SELECT game_server_number FROM commanders WHERE game_uid = ${gameUid}
      `;
      expect(commander?.game_server_number).toBe(PREVIOUS_HOME_SERVER);
      const [audit] = await sql<{ id: string }[]>`
        SELECT id FROM audit_log
        WHERE alliance_id = ${alliance.allianceId}
          AND action = 'member_link.server_transfer_confirmed'
      `;
      expect(audit).toBeUndefined();
    } finally {
      await sql`DELETE FROM commanders WHERE game_uid = ${gameUid}`;
    }
  });

  test("commander positioned away from the alliance server is told to go home", async ({
    page,
  }) => {
    const sql = getE2eSql();
    const allianceServer = 1285;
    const gameUid = "12345678901286";
    const { alliance, accepted, email } = await seedInvitedTransfer(sql, {
      allianceServer,
      gameUid,
    });

    try {
      await page.context().addCookies(
        playwrightAuthCookies({ ...accepted, email }),
      );
      const body = await submitUidThenConfirm(page, gameUid);
      expect(body.outcome).toBe("server_transfer_send_home");
      await expect(
        page.getByRole("heading", { name: /send your commander home/i }),
      ).toBeVisible();
      await expect(page.getByText(/hq last saw/i)).toBeVisible();

      const [link] = await sql<{ id: string }[]>`
        SELECT id FROM hq_member_links
        WHERE alliance_id = ${alliance.allianceId} AND hq_user_id = ${accepted.hqUserId}
      `;
      expect(link).toBeUndefined();
    } finally {
      await sql`DELETE FROM commanders WHERE game_uid = ${gameUid}`;
    }
  });
});
