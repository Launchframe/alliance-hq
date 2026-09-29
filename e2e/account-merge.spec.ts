import { nanoid } from "nanoid";
import { expect, test } from "@playwright/test";

import {
  cleanupSeededActivityEvents,
  seedActivityEvent,
} from "./fixtures/activity";
import {
  createAllianceMembership,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createHqUserOnly,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

const createdAliasOriginals: string[] = [];

test.afterEach(async () => {
  const sql = getE2eSql();
  if (createdAliasOriginals.length > 0) {
    const originals = createdAliasOriginals.splice(0);
    await sql`
      DELETE FROM activity_ownership_aliases
      WHERE original_hq_user_id = ANY(${originals})
    `;
  }
  await cleanupSeededActivityEvents();
});

test.describe("Account merge", () => {
  test("target account merges source with accepted invite membership", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `MG${nanoid(3)}`,
      name: "Merge Alliance",
    });
    const sourceEmail = `source-${nanoid(6)}@alliance-hq.test`;
    const targetEmail = `target-${nanoid(6)}@alliance-hq.test`;

    const sourceUser = await createHqUserOnly(sql, sourceEmail);
    await createAllianceMembership(sql, {
      hqUserId: sourceUser.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    createdAliasOriginals.push(sourceUser.hqUserId);

    const targetSession = await createAuthenticatedHqSession(sql, targetEmail);
    const peer = await createHqUserOnly(sql, `knowledge-peer-${nanoid(6)}@alliance-hq.test`);
    const ownedNoteId = nanoid();
    const sharedNoteId = nanoid();
    await sql`INSERT INTO performance_notes (id, alliance_id, kind, intake_mode, body, source, created_by_hq_user_id)
      VALUES (${ownedNoteId}, ${alliance.allianceId}, 'note', 'thought', 'Private source-account note', 'web', ${sourceUser.hqUserId}),
             (${sharedNoteId}, ${alliance.allianceId}, 'note', 'thought', 'Explicitly shared note', 'web', ${peer.hqUserId})`;
    await sql`INSERT INTO knowledge_resource_grants (id, resource_id, alliance_id, subject_kind, subject_id, role)
      VALUES (${nanoid()}, ${`note:${sharedNoteId}`}, ${alliance.allianceId}, 'user', ${sourceUser.hqUserId}, 'edit'),
             (${nanoid()}, ${`note:${sharedNoteId}`}, ${alliance.allianceId}, 'user', ${targetSession.hqUserId}, 'read')`;
    const preferenceAlliance = await createNativeAlliance(sql, { tag: `MP${nanoid(3)}`, name: "Merged preferences" });
    await sql`INSERT INTO knowledge_workspace_preferences (hq_user_id, alliance_id, state, version) VALUES
      (${sourceUser.hqUserId}, ${alliance.allianceId}, '{"view":"inbox"}'::jsonb, 3),
      (${targetSession.hqUserId}, ${alliance.allianceId}, '{"view":"shared"}'::jsonb, 1),
      (${sourceUser.hqUserId}, ${preferenceAlliance.allianceId}, '{"view":"tasks"}'::jsonb, 4)`;
    const publicationId = nanoid();
    await sql`INSERT INTO knowledge_publications (id, alliance_id, note_id, resource_id, owner_hq_user_id, source_version, snapshot_version, title, body, locale, state, expires_at)
      VALUES (${publicationId}, ${alliance.allianceId}, ${ownedNoteId}, ${`note:${ownedNoteId}`}, ${sourceUser.hqUserId}, 1, 1, 'Public copy', 'Reviewed public words', 'en-US', 'published', now() + interval '7 days')`;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: targetSession.sessionId,
        nextAuthToken: targetSession.nextAuthToken,
      }),
    );

    const requestRes = await page.request.post(
      "/api/user/account-merge/request-source-proof",
      { data: { sourceEmail } },
    );
    expect(requestRes.ok()).toBeTruthy();

    const confirmRes = await page.request.post("/api/user/account-merge/confirm", {
      data: { sourceEmail, code: "424242" },
    });
    expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

    const [sourceRow] = await sql<{ id: string }[]>`
      SELECT id FROM hq_users WHERE id = ${sourceUser.hqUserId}
    `;
    expect(sourceRow).toBeUndefined();

    const [membership] = await sql<{ hq_user_id: string }[]>`
      SELECT hq_user_id
      FROM alliance_memberships
      WHERE alliance_id = ${alliance.allianceId}
        AND hq_user_id = ${targetSession.hqUserId}
      LIMIT 1
    `;
    expect(membership?.hq_user_id).toBe(targetSession.hqUserId);
    const [owned] = await sql`SELECT r.owner_hq_user_id, n.created_by_hq_user_id FROM performance_notes n
      JOIN knowledge_resources r ON r.id = n.resource_id WHERE n.id = ${ownedNoteId}`;
    expect(owned).toMatchObject({ owner_hq_user_id: targetSession.hqUserId, created_by_hq_user_id: targetSession.hqUserId });
    const [publication] = await sql`SELECT owner_hq_user_id FROM knowledge_publications WHERE id = ${publicationId}`;
    expect(publication?.owner_hq_user_id).toBe(targetSession.hqUserId);
    const preferences = await sql`SELECT alliance_id, state, version FROM knowledge_workspace_preferences WHERE hq_user_id = ${targetSession.hqUserId}`;
    expect(preferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ alliance_id: alliance.allianceId, state: { view: "shared" }, version: 1 }),
      expect.objectContaining({ alliance_id: preferenceAlliance.allianceId, state: { view: "tasks" }, version: 4 }),
    ]));
    const grants = await sql`SELECT subject_id, role FROM knowledge_resource_grants
      WHERE resource_id = ${`note:${sharedNoteId}`} AND subject_kind = 'user'`;
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ subject_id: targetSession.hqUserId, role: "edit" });
  });

  test("merge remaps activity ownership onto the canonical account", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `MO${nanoid(3)}`,
      name: "Merge Owners",
    });
    const sourceEmail = `merge-src-${nanoid(6)}@alliance-hq.test`;
    const targetEmail = `merge-tgt-${nanoid(6)}@alliance-hq.test`;
    const sourceUser = await createHqUserOnly(sql, sourceEmail);
    await createAllianceMembership(sql, {
      hqUserId: sourceUser.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    const targetSession = await createAuthenticatedHqSession(sql, targetEmail);
    const otherUser = await createHqUserOnly(
      sql,
      `merge-oth-${nanoid(6)}@alliance-hq.test`,
    );
    createdAliasOriginals.push(sourceUser.hqUserId);

    const srcPrivate = `e2e-act-${nanoid(8)}`;
    const srcAlliance = `e2e-act-${nanoid(8)}`;
    const tgtOwned = `e2e-act-${nanoid(8)}`;
    const otherOwned = `e2e-act-${nanoid(8)}`;

    await seedActivityEvent({
      id: srcPrivate,
      eventKey: "account.merged",
      feature: "account",
      kind: "change",
      visibilityClass: "private",
      originalHqUserId: sourceUser.hqUserId,
      personalOwnerHqUserId: sourceUser.hqUserId,
      actorDisplayName: "Source User",
      occurredAt: "2026-09-29T12:00:00.123456Z",
      payload: {},
    });
    await seedActivityEvent({
      id: srcAlliance,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: alliance.allianceId,
      originalHqUserId: sourceUser.hqUserId,
      personalOwnerHqUserId: sourceUser.hqUserId,
      actorDisplayName: "Source Cmdr",
      occurredAt: "2026-09-29T12:00:00.123456Z",
      actorHqRole: "officer",
      actorGameRank: "R4",
      payload: { value: "7" },
    });
    await seedActivityEvent({
      id: tgtOwned,
      eventKey: "account.merged",
      feature: "account",
      kind: "change",
      visibilityClass: "private",
      originalHqUserId: targetSession.hqUserId,
      personalOwnerHqUserId: targetSession.hqUserId,
      actorDisplayName: "Target User",
      payload: {},
    });
    await seedActivityEvent({
      id: otherOwned,
      eventKey: "account.merged",
      feature: "account",
      kind: "change",
      visibilityClass: "private",
      originalHqUserId: otherUser.hqUserId,
      personalOwnerHqUserId: otherUser.hqUserId,
      actorDisplayName: "Other User",
      payload: {},
    });

    const snapshotOf = async (id: string) =>
      (
        await sql<
          {
            originalHqUserId: string | null;
            actorDisplayName: string | null;
            actorHqRole: string | null;
            actorGameRank: string | null;
            occurredAt: string;
            contentHash: string;
            personalOwnerHqUserId: string | null;
          }[]
        >`
        SELECT original_hq_user_id AS "originalHqUserId",
               actor_display_name AS "actorDisplayName",
               actor_hq_role AS "actorHqRole",
               actor_game_rank AS "actorGameRank",
               occurred_at::text AS "occurredAt",
               content_hash AS "contentHash",
               personal_owner_hq_user_id AS "personalOwnerHqUserId"
        FROM activity_events WHERE id = ${id}
      `
      )[0];
    const beforeSrcPrivate = await snapshotOf(srcPrivate);
    const beforeSrcAlliance = await snapshotOf(srcAlliance);

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: targetSession.sessionId,
        nextAuthToken: targetSession.nextAuthToken,
      }),
    );
    const requestRes = await page.request.post(
      "/api/user/account-merge/request-source-proof",
      { data: { sourceEmail } },
    );
    expect(requestRes.ok()).toBeTruthy();
    const confirmRes = await page.request.post(
      "/api/user/account-merge/confirm",
      { data: { sourceEmail, code: "424242" } },
    );
    expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

    for (const [before, id] of [
      [beforeSrcPrivate, srcPrivate],
      [beforeSrcAlliance, srcAlliance],
    ] as const) {
      const after = await snapshotOf(id);
      expect(after.personalOwnerHqUserId).toBe(targetSession.hqUserId);
      expect(after.originalHqUserId).toBe(before.originalHqUserId);
      expect(after.originalHqUserId).toBe(sourceUser.hqUserId);
      expect(after.actorDisplayName).toBe(before.actorDisplayName);
      expect(after.actorHqRole).toBe(before.actorHqRole);
      expect(after.actorGameRank).toBe(before.actorGameRank);
      expect(after.occurredAt).toBe(before.occurredAt);
      expect(after.occurredAt).toContain(".123456");
      expect(after.contentHash).toBe(before.contentHash);
    }
    expect((await snapshotOf(tgtOwned)).personalOwnerHqUserId).toBe(
      targetSession.hqUserId,
    );
    expect((await snapshotOf(otherOwned)).personalOwnerHqUserId).toBe(
      otherUser.hqUserId,
    );

    const aliases = await sql<{ owner: string }[]>`
      SELECT personal_owner_hq_user_id AS owner
      FROM activity_ownership_aliases
      WHERE original_hq_user_id = ${sourceUser.hqUserId}
    `;
    expect(aliases).toEqual([{ owner: targetSession.hqUserId }]);

    const personalRes = await page.request.get("/api/activity/personal");
    expect(personalRes.status()).toBe(200);
    const personalBody = await personalRes.json();
    const itemIds = (personalBody.items ?? []).map(
      (item: { id: string }) => item.id,
    );
    expect(itemIds).toEqual(
      expect.arrayContaining([srcPrivate, srcAlliance, tgtOwned]),
    );
    expect(itemIds).not.toContain(otherOwned);
  });

  test("settings page exposes combine accounts UI", async ({ page }) => {
    const sql = getE2eSql();
    const alliance = await createNativeAlliance(sql, {
      tag: `MG${nanoid(3)}`,
      name: "Merge Settings Alliance",
    });
    const email = `merge-settings-${nanoid(6)}@alliance-hq.test`;
    const session = await createAuthenticatedHqSession(sql, email);
    await createAllianceMembership(sql, {
      hqUserId: session.hqUserId,
      allianceId: alliance.allianceId,
      roleName: "member",
      source: "manual",
    });
    await createHqMemberLink(sql, {
      allianceId: alliance.allianceId,
      hqUserId: session.hqUserId,
    });
    await sql`
      UPDATE sessions
      SET current_alliance_id = ${alliance.allianceId}
      WHERE id = ${session.sessionId}
    `;

    await page.context().addCookies(
      playwrightAuthCookies({
        sessionId: session.sessionId,
        nextAuthToken: session.nextAuthToken,
      }),
    );

    await page.goto("/settings/account");

    await expect(page.getByRole("heading", { name: /Combine accounts/i })).toBeVisible();
    await expect(
      page
        .getByRole("heading", { name: /Combine accounts/i })
        .locator("..")
        .getByRole("button", { name: /Send verification code/i }),
    ).toBeVisible();
  });
});
