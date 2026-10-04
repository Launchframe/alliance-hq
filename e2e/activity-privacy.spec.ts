import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  authCookieHeader,
  createAllianceMembership,
  createAuthenticatedHqSession,
  createBrowserSession,
  createNativeAlliance,
  createPlatformMaintainerSession,
  getE2eSql,
  type SessionFixture,
} from "./fixtures/db";

const ENDPOINTS = {
  personal: "/api/activity/personal",
  alliance: "/api/activity/alliance",
  global: "/api/admin/activity",
} as const;

const seededEventIds: string[] = [];

async function seedActivityEvent(row: {
  id: string;
  eventKey: string;
  feature: string;
  kind: string;
  visibilityClass: "alliance" | "private";
  occurredAt?: string;
  allianceId?: string | null;
  actorKind?: string;
  originalHqUserId?: string | null;
  originalDiscordUserId?: string | null;
  personalOwnerHqUserId?: string | null;
  actorDisplayName?: string | null;
  actorHqRole?: string | null;
  actorGameRank?: string | null;
  serverNumber?: string | null;
  allianceTag?: string | null;
  allianceName?: string | null;
  channel?: string | null;
  method?: string | null;
  severity?: string;
  resourceKind?: string | null;
  resourceId?: string | null;
  payload: Record<string, unknown>;
  historical?: boolean;
}) {
  const sql = getE2eSql();
  seededEventIds.push(row.id);
  await sql`
    INSERT INTO activity_events (
      id, event_key, feature, kind, occurred_at,
      alliance_id, actor_kind, original_hq_user_id, original_discord_user_id,
      personal_owner_hq_user_id, actor_display_name, actor_hq_role,
      actor_game_rank, server_number, alliance_tag, alliance_name, channel,
      method, severity, visibility_class, resource_kind, resource_id, payload,
      source_namespace, source_key, content_hash, historical
    ) VALUES (
      ${row.id}, ${row.eventKey}, ${row.feature}, ${row.kind},
      ${row.occurredAt ?? "2026-09-29T12:00:00.000000Z"},
      ${row.allianceId ?? null}, ${row.actorKind ?? "hq"},
      ${row.originalHqUserId ?? null}, ${row.originalDiscordUserId ?? null},
      ${row.personalOwnerHqUserId ?? null}, ${row.actorDisplayName ?? null},
      ${row.actorHqRole ?? null}, ${row.actorGameRank ?? null},
      ${row.serverNumber ?? null}, ${row.allianceTag ?? null},
      ${row.allianceName ?? null}, ${row.channel ?? "web"},
      ${row.method ?? "manual"}, ${row.severity ?? "update"},
      ${row.visibilityClass}, ${row.resourceKind ?? null},
      ${row.resourceId ?? null}, ${sql.json(row.payload)},
      ${"e2e-activity-privacy"}, ${row.id}, ${"e2e-content-hash"},
      ${row.historical ?? false}
    )
  `;
}

function cookie(fixture: SessionFixture) {
  return { Cookie: authCookieHeader(fixture) };
}

async function createOfficerFixture() {
  const sql = getE2eSql();
  const tag = `A${randomUUID().replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase()}`;
  const alliance = await createNativeAlliance(sql, {
    tag,
    name: `Activity ${tag}`,
  });
  const officer = await createAuthenticatedHqSession(
    sql,
    `officer-${randomUUID()}@e2e.test`,
  );
  await createAllianceMembership(sql, {
    hqUserId: officer.hqUserId,
    allianceId: alliance.allianceId,
    roleName: "officer",
    source: "manual",
  });
  await sql`
    UPDATE sessions SET current_alliance_id = ${alliance.allianceId}
    WHERE id = ${officer.sessionId}
  `;
  return { officer, allianceId: alliance.allianceId, tag };
}

test.afterEach(async () => {
  const sql = getE2eSql();
  const ids = seededEventIds.splice(0);
  if (ids.length > 0) {
    await sql`DELETE FROM activity_events WHERE id = ANY(${ids})`;
  }
});

test.describe("Activity feed scoped reads", () => {
  test("rejects missing and bootstrap sessions on every scope", async ({
    request,
  }) => {
    for (const path of Object.values(ENDPOINTS)) {
      const res = await request.get(path);
      expect(res.status()).toBe(401);
      expect(res.headers()["cache-control"]).toContain("private");
      expect(res.headers()["cache-control"]).toContain("no-store");
      expect(await res.json()).toMatchObject({
        error: "Your access has changed. Refresh to continue.",
        errorKey: "activity.accessChanged",
        code: "unauthorized",
      });
    }

    const sql = getE2eSql();
    const bootstrap = await createBrowserSession(sql, { hqUserId: null });
    for (const path of Object.values(ENDPOINTS)) {
      const res = await request.get(path, {
        headers: { Cookie: `alliance_hq_session=${bootstrap.sessionId}` },
      });
      expect(res.status()).toBe(403);
      expect(await res.json()).toMatchObject({
        error: "Your access has changed. Refresh to continue.",
        errorKey: "activity.accessChanged",
        code: "forbidden",
      });
    }

    const localized = await request.get(ENDPOINTS.global, {
      headers: {
        Cookie: `alliance_hq_session=${bootstrap.sessionId}`,
        "x-activity-locale": "pt-BR",
      },
    });
    expect(localized.status()).toBe(403);
    expect(await localized.json()).toMatchObject({
      error: "Seu acesso mudou. Atualize para continuar.",
      errorKey: "activity.accessChanged",
      code: "forbidden",
    });
  });

  test("rejects a session cookie bound to a different auth identity", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const bound = await createAuthenticatedHqSession(
      sql,
      `bound-${randomUUID()}@e2e.test`,
    );
    const other = await createAuthenticatedHqSession(
      sql,
      `other-${randomUUID()}@e2e.test`,
    );
    const res = await request.get(ENDPOINTS.personal, {
      headers: {
        Cookie: `alliance_hq_session=${bound.sessionId}; authjs.session-token=${other.nextAuthToken}`,
      },
    });
    expect(res.status()).toBe(403);
  });

  test("member reads own personal history but not alliance or global", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const member = await createAuthenticatedHqSession(
      sql,
      `member-${randomUUID()}@e2e.test`,
    );

    const own = `e2e-act-own-${randomUUID()}`;
    const ownPast = `e2e-act-past-${randomUUID()}`;
    const foreign = `e2e-act-foreign-${randomUUID()}`;
    const pastAlliance = `e2e-act-past-all-${randomUUID()}`;
    await seedActivityEvent({
      id: own,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: `e2e-act-all-${randomUUID()}`,
      personalOwnerHqUserId: member.hqUserId,
      originalHqUserId: member.hqUserId,
      actorDisplayName: "E2E User",
      payload: { value: "5" },
    });
    await seedActivityEvent({
      id: ownPast,
      eventKey: "vr.submitted",
      feature: "vr",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: pastAlliance,
      personalOwnerHqUserId: member.hqUserId,
      originalHqUserId: member.hqUserId,
      actorDisplayName: "E2E User",
      payload: { value: "8" },
      historical: true,
    });
    await seedActivityEvent({
      id: foreign,
      eventKey: "member.promoted",
      feature: "members",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: `e2e-act-all-${randomUUID()}`,
      personalOwnerHqUserId: `e2e-other-owner-${randomUUID()}`,
      originalHqUserId: `e2e-other-actor-${randomUUID()}`,
      actorDisplayName: "Officer Else",
      payload: { member: "E2E User", fromRank: "R2", toRank: "R4" },
    });

    const personal = await request.get(ENDPOINTS.personal, {
      headers: cookie(member),
    });
    expect(personal.status()).toBe(200);
    const body = await personal.json();
    expect(body.scope).toBe("personal");
    expect(body.allowedScopes).toEqual(["personal"]);
    expect(body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [own, ownPast].sort(),
    );
    expect(
      body.items.every(
        (item: { actor: unknown; details: unknown }) =>
          item.actor === null &&
          Object.keys(item.details as object).length === 0,
      ),
    ).toBe(true);

    const filtered = await request.get(
      `${ENDPOINTS.personal}?allianceId=${pastAlliance}`,
      { headers: cookie(member) },
    );
    expect(filtered.status()).toBe(200);
    expect(
      (await filtered.json()).items.map((item: { id: string }) => item.id),
    ).toEqual([ownPast]);

    const alliance = await request.get(ENDPOINTS.alliance, {
      headers: cookie(member),
    });
    expect(alliance.status()).toBe(403);
    const globalFeed = await request.get(ENDPOINTS.global, {
      headers: cookie(member),
    });
    expect(globalFeed.status()).toBe(403);
  });

  test("officer sees only alliance-visibility tenant rows before the limit", async ({
    request,
  }) => {
    const { officer, allianceId, tag } = await createOfficerFixture();
    const headers = cookie(officer);

    for (let i = 0; i < 50; i++) {
      await seedActivityEvent({
        id: `e2e-act-priv-${i}-${randomUUID()}`,
        eventKey: "note.updated",
        feature: "notes",
        kind: "change",
        visibilityClass: "private",
        allianceId,
        occurredAt: `2026-09-29T13:00:${String(i).padStart(2, "0")}.000000Z`,
        personalOwnerHqUserId: officer.hqUserId,
        originalHqUserId: officer.hqUserId,
        payload: {},
      });
    }
    const a1 = `e2e-act-a1-${randomUUID()}`;
    const a2 = `e2e-act-a2-${randomUUID()}`;
    await seedActivityEvent({
      id: a1,
      eventKey: "member.promoted",
      feature: "members",
      kind: "change",
      visibilityClass: "alliance",
      allianceId,
      allianceTag: tag,
      occurredAt: "2026-09-29T12:00:00.000000Z",
      personalOwnerHqUserId: officer.hqUserId,
      originalHqUserId: officer.hqUserId,
      actorDisplayName: "Officer One",
      payload: { member: "Cmdr One", fromRank: "R2", toRank: "R4" },
    });
    await seedActivityEvent({
      id: a2,
      eventKey: "scores.discarded",
      feature: "scores",
      kind: "change",
      visibilityClass: "alliance",
      allianceId,
      occurredAt: "2026-09-29T12:30:00.000000Z",
      personalOwnerHqUserId: officer.hqUserId,
      originalHqUserId: officer.hqUserId,
      payload: { affected: 5, completed: 3 },
    });
    await seedActivityEvent({
      id: `e2e-act-tenant-${randomUUID()}`,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: `e2e-foreign-tenant-${randomUUID()}`,
      occurredAt: "2026-09-29T14:00:00.000000Z",
      payload: { value: "9" },
    });

    const head = await request.get(`${ENDPOINTS.alliance}?view=head`, {
      headers,
    });
    expect(head.status()).toBe(200);
    expect(head.headers()["cache-control"]).toContain("no-store");
    expect((await head.json()).head.id).toBe(a2);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res = await request.get(
        `${ENDPOINTS.alliance}?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { headers },
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.scope).toBe("alliance");
      seen.push(...body.items.map((item: { id: string }) => item.id));
      cursor = body.nextCursor;
      if (!cursor) {
        break;
      }
    }
    expect(seen).toEqual([a2, a1]);

    const globalRes = await request.get(ENDPOINTS.global, { headers });
    expect(globalRes.status()).toBe(403);
  });

  test("maintainer sees content-free private rows across tenants", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const privateId = `e2e-act-gpriv-${randomUUID()}`;
    const publicId = `e2e-act-gpub-${randomUUID()}`;
    const windowQuery = `from=${encodeURIComponent("2030-01-15T00:00:00.000000Z")}&to=${encodeURIComponent("2030-01-16T00:00:00.000000Z")}`;
    await seedActivityEvent({
      id: privateId,
      eventKey: "account.email_changed",
      feature: "account",
      kind: "change",
      visibilityClass: "private",
      allianceId: `e2e-act-all-${randomUUID()}`,
      occurredAt: "2030-01-15T10:01:00.000000Z",
      originalHqUserId: maintainer.hqUserId,
      personalOwnerHqUserId: maintainer.hqUserId,
      actorDisplayName: "Private Maintainer",
      resourceKind: null,
      payload: {},
    });
    await seedActivityEvent({
      id: publicId,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: `e2e-act-all-${randomUUID()}`,
      occurredAt: "2030-01-15T10:00:00.000000Z",
      originalHqUserId: maintainer.hqUserId,
      personalOwnerHqUserId: maintainer.hqUserId,
      actorDisplayName: "Public Maintainer",
      payload: { value: "42" },
    });

    const res = await request.get(`${ENDPOINTS.global}?${windowQuery}`, {
      headers: cookie(maintainer),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("global");
    expect(body.allowedScopes).toContain("global");
    expect(
      body.items.map((item: { id: string }) => item.id).sort(),
    ).toEqual([privateId, publicId].sort());

    const privateItem = body.items.find(
      (item: { id: string }) => item.id === privateId,
    );
    expect(privateItem).toBeTruthy();
    expect(privateItem.values).toEqual({});
    expect(privateItem.actor).toBeNull();
    expect(privateItem.details).toEqual({});
    expect(privateItem).not.toHaveProperty("resourceId");

    const publicItem = body.items.find(
      (item: { id: string }) => item.id === publicId,
    );
    expect(publicItem.values.value).toBe("42");
    expect(publicItem.actor).toMatchObject({
      key: `hq:${maintainer.hqUserId}`,
    });

    const actorFiltered = await request.get(
      `${ENDPOINTS.global}?${windowQuery}&actor=${encodeURIComponent(`hq:${maintainer.hqUserId}`)}`,
      { headers: cookie(maintainer) },
    );
    expect(actorFiltered.status()).toBe(200);
    const actorBody = await actorFiltered.json();
    expect(actorBody.items.map((item: { id: string }) => item.id)).toEqual([
      publicId,
    ]);

    const head = await request.get(
      `${ENDPOINTS.global}?view=head&${windowQuery}&actor=${encodeURIComponent(`hq:${maintainer.hqUserId}`)}`,
      { headers: cookie(maintainer) },
    );
    expect(head.status()).toBe(200);
    expect((await head.json()).head.id).toBe(publicId);
  });

  test("global filter suggestions never expose private-only actors or tenants", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const maintainer = await createPlatformMaintainerSession(sql);
    const privateOwner = await createAuthenticatedHqSession(
      sql,
      `private-owner-${randomUUID()}@e2e.test`,
    );
    const windowQuery = `from=${encodeURIComponent("2030-02-10T00:00:00.000000Z")}&to=${encodeURIComponent("2030-02-11T00:00:00.000000Z")}`;
    const suffix = randomUUID().slice(0, 8);
    const privateEventId = `e2e-act-privopt-${randomUUID()}`;
    const privateAllianceId = `e2e-act-privall-${randomUUID()}`;
    const privateActorId = `e2e-priv-actor-${randomUUID()}`;
    const privateActorName = `PvtActor-${suffix}`;
    const privateAllianceName = `PvtAlliance-${suffix}`;
    const privateAllianceTag = `PV${suffix.slice(0, 4).toUpperCase()}`;
    const privateServer = "98761";
    const publicEventId = `e2e-act-pubopt-${randomUUID()}`;
    const publicAllianceId = `e2e-act-puball-${randomUUID()}`;
    const publicActorId = `e2e-pub-actor-${randomUUID()}`;
    const publicActorName = `PubActor-${suffix}`;
    const publicAllianceTag = `PU${suffix.slice(0, 4).toUpperCase()}`;
    const publicServer = "98762";

    await seedActivityEvent({
      id: privateEventId,
      eventKey: "account.email_changed",
      feature: "account",
      kind: "change",
      visibilityClass: "private",
      allianceId: privateAllianceId,
      occurredAt: "2030-02-10T10:00:00.000000Z",
      originalHqUserId: privateActorId,
      personalOwnerHqUserId: privateOwner.hqUserId,
      actorDisplayName: privateActorName,
      allianceTag: privateAllianceTag,
      allianceName: privateAllianceName,
      serverNumber: privateServer,
      payload: {},
    });
    await seedActivityEvent({
      id: publicEventId,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: publicAllianceId,
      occurredAt: "2030-02-10T10:05:00.000000Z",
      originalHqUserId: publicActorId,
      personalOwnerHqUserId: publicActorId,
      actorDisplayName: publicActorName,
      allianceTag: publicAllianceTag,
      allianceName: `PubAlliance-${suffix}`,
      serverNumber: publicServer,
      payload: { value: "7" },
    });

    const options = async (extra = "") => {
      const res = await request.get(
        `${ENDPOINTS.global}?view=filters&${windowQuery}${extra}`,
        { headers: cookie(maintainer) },
      );
      expect(res.status()).toBe(200);
      return (await res.json()).options;
    };

    const qPrivateActor = await options(`&q=${encodeURIComponent(privateActorName)}`);
    expect(
      qPrivateActor.actors.map((actor: { value: string }) => actor.value),
    ).not.toContain(`hq:${privateActorId}`);
    expect(JSON.stringify(qPrivateActor)).not.toContain(privateActorName);

    const qPrivateAlliance = await options(
      `&q=${encodeURIComponent(privateAllianceTag)}`,
    );
    expect(JSON.stringify(qPrivateAlliance)).not.toContain(privateAllianceId);
    expect(JSON.stringify(qPrivateAlliance)).not.toContain(privateAllianceTag);

    const unfiltered = await options();
    expect(
      unfiltered.actors.map((actor: { value: string }) => actor.value),
    ).not.toContain(`hq:${privateActorId}`);
    expect(
      unfiltered.alliances.map((alliance: { id: string }) => alliance.id),
    ).not.toContain(privateAllianceId);
    expect(
      unfiltered.servers.map((server: string) => server),
    ).not.toContain(privateServer);
    expect(
      unfiltered.actors.map((actor: { value: string }) => actor.value),
    ).toContain(`hq:${publicActorId}`);
    expect(
      unfiltered.alliances.map((alliance: { id: string }) => alliance.id),
    ).toContain(publicAllianceId);
    expect(unfiltered.servers).toContain(publicServer);

    const personal = await request.get(
      `${ENDPOINTS.personal}?${windowQuery}`,
      { headers: cookie(privateOwner) },
    );
    expect(personal.status()).toBe(200);
    expect(
      (await personal.json()).items.map((item: { id: string }) => item.id),
    ).toEqual([privateEventId]);
  });

  test("scope-forged filters are rejected or stay fenced", async ({
    request,
  }) => {
    const { officer, allianceId } = await createOfficerFixture();
    const headers = cookie(officer);
    const seed = {
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance" as const,
      allianceId,
      personalOwnerHqUserId: officer.hqUserId,
      originalHqUserId: officer.hqUserId,
      payload: { value: "3" },
    };
    await seedActivityEvent({ id: `e2e-act-f1-${randomUUID()}`, ...seed });

    expect(
      (
        await request.get(`${ENDPOINTS.personal}?actor=hq%3Aforged`, {
          headers,
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.get(
          `${ENDPOINTS.alliance}?allianceId=${encodeURIComponent(allianceId)}`,
          { headers },
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.get(`${ENDPOINTS.alliance}?server=1203`, { headers })
      ).status(),
    ).toBe(400);
    expect(
      (await request.get(`${ENDPOINTS.alliance}?bogus=1`, { headers })).status(),
    ).toBe(400);
    expect(
      (
        await request.get(
          `${ENDPOINTS.alliance}?limit=1&limit=2`,
          { headers },
        )
      ).status(),
    ).toBe(400);

    const actorFiltered = await request.get(
      `${ENDPOINTS.alliance}?actor=${encodeURIComponent(`hq:${officer.hqUserId}`)}`,
      { headers },
    );
    expect(actorFiltered.status()).toBe(200);
    const actorBody = await actorFiltered.json();
    expect(actorBody.items).toHaveLength(1);
  });

  test("cursor fence binds principal, filters, and live membership", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { officer, allianceId } = await createOfficerFixture();
    const headers = cookie(officer);
    const seed = {
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance" as const,
      allianceId,
      personalOwnerHqUserId: officer.hqUserId,
      originalHqUserId: officer.hqUserId,
      payload: { value: "3" },
    };
    await seedActivityEvent({
      id: `e2e-act-c1-${randomUUID()}`,
      ...seed,
      occurredAt: "2026-09-29T12:00:00.000000Z",
    });
    await seedActivityEvent({
      id: `e2e-act-c2-${randomUUID()}`,
      ...seed,
      occurredAt: "2026-09-29T11:00:00.000000Z",
    });

    const first = await request.get(`${ENDPOINTS.alliance}?limit=1`, {
      headers,
    });
    expect(first.status()).toBe(200);
    const { nextCursor } = await first.json();
    const tampered = (patch: Record<string, unknown>) =>
      encodeURIComponent(
        JSON.stringify({ ...JSON.parse(nextCursor), ...patch }),
      );

    expect(
      (
        await request.get(
          `${ENDPOINTS.alliance}?limit=1&cursor=${tampered({ scope: "global" })}`,
          { headers },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.get(
          `${ENDPOINTS.alliance}?limit=1&cursor=${tampered({ scopeFence: "[\"forged\",null]" })}`,
          { headers },
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.get(
          `${ENDPOINTS.alliance}?limit=1&cursor=${tampered({ key: "0".repeat(64) })}`,
          { headers },
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.get(
          `${ENDPOINTS.alliance}?limit=1&cursor=${encodeURIComponent("not-json")}`,
          { headers },
        )
      ).status(),
    ).toBe(400);

    const second = await request.get(
      `${ENDPOINTS.alliance}?limit=1&cursor=${encodeURIComponent(nextCursor)}`,
      { headers },
    );
    expect(second.status()).toBe(200);

    await sql`
      DELETE FROM alliance_memberships
      WHERE hq_user_id = ${officer.hqUserId} AND alliance_id = ${allianceId}
    `;
    const revoked = await request.get(
      `${ENDPOINTS.alliance}?limit=1&cursor=${encodeURIComponent(nextCursor)}`,
      { headers },
    );
    expect(revoked.status()).toBe(403);
  });

  test("scope fence rejects stale selection across views", async ({
    request,
  }) => {
    const sql = getE2eSql();
    const { officer } = await createOfficerFixture();
    const headers = cookie(officer);

    const first = await request.get(ENDPOINTS.personal, { headers });
    expect(first.status()).toBe(200);
    const staleFence = (await first.json()).scopeFence;

    const second = await createNativeAlliance(sql, {
      tag: `B${randomUUID().replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase()}`,
      name: "Second Alliance",
    });
    await sql`
      UPDATE sessions SET current_alliance_id = ${second.allianceId}
      WHERE id = ${officer.sessionId}
    `;

    for (const view of ["page", "head", "filters"]) {
      const res = await request.get(`${ENDPOINTS.personal}?view=${view}`, {
        headers: { ...headers, "x-activity-scope": staleFence },
      });
      expect(res.status()).toBe(403);
    }

    const fresh = await request.get(ENDPOINTS.personal, { headers });
    expect(fresh.status()).toBe(200);
    const freshBody = await fresh.json();
    expect(freshBody.scopeFence).not.toBe(staleFence);
    expect(freshBody.scopeFence).toBe(
      JSON.stringify([officer.hqUserId, second.allianceId]),
    );
  });

  test("microsecond and equal-timestamp ordering is deterministic", async ({
    request,
  }) => {
    const { officer, allianceId } = await createOfficerFixture();
    const headers = cookie(officer);
    const seed = {
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance" as const,
      allianceId,
      personalOwnerHqUserId: officer.hqUserId,
      originalHqUserId: officer.hqUserId,
      payload: { value: "3" },
    };
    const tieA = `e2e-act-tie-a-${randomUUID()}`;
    const tieB = `e2e-act-tie-b-${randomUUID()}`;
    const older = `e2e-act-old-${randomUUID()}`;
    await seedActivityEvent({
      id: tieA,
      ...seed,
      occurredAt: "2026-09-29T12:00:00.123456Z",
    });
    await seedActivityEvent({
      id: tieB,
      ...seed,
      occurredAt: "2026-09-29T12:00:00.123456Z",
    });
    await seedActivityEvent({
      id: older,
      ...seed,
      occurredAt: "2026-09-29T12:00:00.123455Z",
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const res = await request.get(
        `${ENDPOINTS.alliance}?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { headers },
      );
      expect(res.status()).toBe(200);
      const body = await res.json();
      seen.push(...body.items.map((item: { id: string }) => item.id));
      cursor = body.nextCursor;
      if (!cursor) {
        break;
      }
    }
    expect(seen).toEqual([tieB, tieA, older]);
    expect(new Set(seen).size).toBe(3);
  });

  test("filters view only exposes authorized suggestion rows", async ({
    request,
  }) => {
    const { officer, allianceId, tag } = await createOfficerFixture();
    const headers = cookie(officer);
    const leakActor = `e2e-leak-actor-${randomUUID()}`;
    const foreignActor = `e2e-foreign-actor-${randomUUID()}`;
    const hiddenActor = `e2e-hidden-${randomUUID()}`;
    await seedActivityEvent({
      id: `e2e-act-m1-${randomUUID()}`,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId,
      allianceTag: tag,
      allianceName: "Activity Alliance",
      serverNumber: "1203",
      personalOwnerHqUserId: officer.hqUserId,
      originalHqUserId: officer.hqUserId,
      actorDisplayName: "Officer Visible",
      payload: { value: "3" },
    });
    await seedActivityEvent({
      id: `e2e-act-m2-${randomUUID()}`,
      eventKey: "note.updated",
      feature: "notes",
      kind: "change",
      visibilityClass: "private",
      allianceId,
      originalHqUserId: leakActor,
      actorDisplayName: "leak@e2e.test",
      payload: {},
    });
    await seedActivityEvent({
      id: `e2e-act-m3-${randomUUID()}`,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId: `e2e-foreign-tenant-${randomUUID()}`,
      originalHqUserId: foreignActor,
      actorDisplayName: "Foreign Actor",
      payload: { value: "7" },
    });
    await seedActivityEvent({
      id: `e2e-act-m4-${randomUUID()}`,
      eventKey: "thp.submitted",
      feature: "thp",
      kind: "change",
      visibilityClass: "alliance",
      allianceId,
      originalHqUserId: hiddenActor,
      actorDisplayName: "hidden-fragment@e2e.test",
      payload: { value: "4" },
    });

    const res = await request.get(`${ENDPOINTS.alliance}?view=filters`, {
      headers,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const actorValues = body.options.actors.map(
      (actor: { value: string }) => actor.value,
    );
    expect(actorValues).toContain(`hq:${officer.hqUserId}`);
    expect(actorValues).toContain(`hq:${hiddenActor}`);
    expect(actorValues).not.toContain(`hq:${leakActor}`);
    expect(actorValues).not.toContain(`hq:${foreignActor}`);
    expect(
      body.options.actors.find(
        (actor: { value: string }) => actor.value === `hq:${hiddenActor}`,
      ).label,
    ).toBeNull();
    expect(body.options.servers).toEqual([]);
    expect(body.options.alliances).toEqual([]);
    expect(body.options.categories).toContain("thp");
    expect(body.options.channels).toContain("web");
    expect(JSON.stringify(body)).not.toContain("leak@e2e.test");

    const narrowed = await request.get(
      `${ENDPOINTS.alliance}?view=filters&q=${encodeURIComponent("hidden-fragment")}`,
      { headers },
    );
    expect(narrowed.status()).toBe(200);
    const narrowedActors = (await narrowed.json()).options.actors.map(
      (actor: { value: string }) => actor.value,
    );
    expect(narrowedActors).not.toContain(`hq:${hiddenActor}`);

    const literal = await request.get(
      `${ENDPOINTS.alliance}?view=filters&q=${encodeURIComponent("%")}`,
      { headers },
    );
    expect(literal.status()).toBe(200);
    const literalActors = (await literal.json()).options.actors.map(
      (actor: { value: string }) => actor.value,
    );
    expect(literalActors).not.toContain(`hq:${officer.hqUserId}`);
  });
});
