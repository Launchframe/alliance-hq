import { randomBytes } from "node:crypto";

import { nanoid } from "nanoid";
import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}@e2e.test`;
}

const FREE_WEEK = {
  sun: { conductorRule: null, vipRule: { kind: "none" } },
  mon: { conductorRule: null, vipRule: { kind: "none" } },
  tue: { conductorRule: { kind: "vs_top_n", topN: 5 }, vipRule: null },
  wed: { conductorRule: { kind: "vs_top_n", topN: 5 }, vipRule: null },
  thu: { conductorRule: null, vipRule: { kind: "none" } },
  fri: { conductorRule: null, vipRule: { kind: "none" } },
  sat: { conductorRule: null, vipRule: { kind: "none" } },
};

type Fixture = { cookieHeader: string; allianceId: string };

async function setupOfficer(
  request: APIRequestContext,
  roleName = "officer",
): Promise<Fixture> {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `TT${nanoid(4)}`,
    name: "Rule Template Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail("rule-template"),
  );
  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: alliance.allianceId,
    roleName,
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: auth.hqUserId,
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Rule Template Roster Member",
  });
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;

  const cookies = playwrightAuthCookies({
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
  });
  return {
    cookieHeader: cookies
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; "),
    allianceId: alliance.allianceId,
  };
}

async function listTemplates(
  request: APIRequestContext,
  cookieHeader: string,
): Promise<
  Array<{
    id: string;
    name: string;
    presetKey: string | null;
    isPreset: boolean;
    archived: boolean;
  }>
> {
  const res = await request.get("/api/trains/rule-templates", {
    headers: { Cookie: cookieHeader },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).templates;
}

test.describe("Train rule templates", () => {
  test("ships seeded presets that every alliance can see", async ({
    request,
  }) => {
    const officer = await setupOfficer(request);
    const templates = await listTemplates(request, officer.cookieHeader);
    const presetKeys = templates
      .filter((template) => template.isPreset)
      .map((template) => template.presetKey);

    expect(presetKeys).toEqual(
      expect.arrayContaining([
        "vs_push_week",
        "economy_week",
        "price_is_right",
        "r3_recognition",
        "r4_train_week",
        "donations_week",
        "custom",
      ]),
    );
  });

  test("an alliance can create, edit, and archive its own template", async ({
    request,
  }) => {
    const officer = await setupOfficer(request);

    const created = await request.post("/api/trains/rule-templates", {
      headers: {
        Cookie: officer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { name: "Our push week", days: FREE_WEEK },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { template } = await created.json();
    expect(template.isPreset).toBe(false);
    expect(template.days.tue.conductorRule).toEqual({
      kind: "vs_top_n",
      topN: 5,
    });

    const renamed = await request.patch(
      `/api/trains/rule-templates/${template.id}`,
      {
        headers: {
          Cookie: officer.cookieHeader,
          "Content-Type": "application/json",
        },
        data: { name: "Our push week v2" },
      },
    );
    expect(renamed.ok(), await renamed.text()).toBeTruthy();
    expect((await renamed.json()).template.name).toBe("Our push week v2");

    const archived = await request.delete(
      `/api/trains/rule-templates/${template.id}`,
      { headers: { Cookie: officer.cookieHeader } },
    );
    expect(archived.ok(), await archived.text()).toBeTruthy();
    expect((await archived.json()).template.archived).toBe(true);
  });

  test("rejects a duplicate template name within one alliance", async ({
    request,
  }) => {
    const officer = await setupOfficer(request);
    const body = {
      headers: {
        Cookie: officer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { name: "Same name", days: FREE_WEEK },
    };
    expect((await request.post("/api/trains/rule-templates", body)).status()).toBe(
      201,
    );
    expect((await request.post("/api/trains/rule-templates", body)).status()).toBe(
      409,
    );
  });

  test("a preset cannot be edited, only archived per alliance", async ({
    request,
  }) => {
    const officer = await setupOfficer(request);
    const templates = await listTemplates(request, officer.cookieHeader);
    const preset = templates.find(
      (template) => template.presetKey === "economy_week",
    )!;

    const edit = await request.patch(
      `/api/trains/rule-templates/${preset.id}`,
      {
        headers: {
          Cookie: officer.cookieHeader,
          "Content-Type": "application/json",
        },
        data: { name: "Hijacked preset" },
      },
    );
    expect(edit.status()).toBe(403);

    const archive = await request.patch(
      `/api/trains/rule-templates/${preset.id}`,
      {
        headers: {
          Cookie: officer.cookieHeader,
          "Content-Type": "application/json",
        },
        data: { archived: true },
      },
    );
    expect(archive.ok(), await archive.text()).toBeTruthy();
    expect((await archive.json()).template.archived).toBe(true);
  });

  test("archiving a preset does not hide it from another alliance", async ({
    request,
  }) => {
    const first = await setupOfficer(request);
    const second = await setupOfficer(request);

    const preset = (await listTemplates(request, first.cookieHeader)).find(
      (template) => template.presetKey === "r3_recognition",
    )!;
    await request.patch(`/api/trains/rule-templates/${preset.id}`, {
      headers: { Cookie: first.cookieHeader, "Content-Type": "application/json" },
      data: { archived: true },
    });

    const forFirst = (await listTemplates(request, first.cookieHeader)).find(
      (template) => template.id === preset.id,
    );
    const forSecond = (await listTemplates(request, second.cookieHeader)).find(
      (template) => template.id === preset.id,
    );
    expect(forFirst?.archived).toBe(true);
    expect(forSecond?.archived).toBe(false);
  });

  test("one alliance cannot read or edit another's template", async ({
    request,
  }) => {
    const owner = await setupOfficer(request);
    const outsider = await setupOfficer(request);

    const created = await request.post("/api/trains/rule-templates", {
      headers: { Cookie: owner.cookieHeader, "Content-Type": "application/json" },
      data: { name: "Private template", days: FREE_WEEK },
    });
    const { template } = await created.json();

    const visible = (await listTemplates(request, outsider.cookieHeader)).some(
      (row) => row.id === template.id,
    );
    expect(visible).toBe(false);

    const edit = await request.patch(
      `/api/trains/rule-templates/${template.id}`,
      {
        headers: {
          Cookie: outsider.cookieHeader,
          "Content-Type": "application/json",
        },
        data: { name: "Stolen" },
      },
    );
    expect(edit.status()).toBe(404);
  });

  test("a paint cannot reference another alliance's template", async ({
    request,
  }) => {
    const owner = await setupOfficer(request);
    const outsider = await setupOfficer(request);

    const created = await request.post("/api/trains/rule-templates", {
      headers: { Cookie: owner.cookieHeader, "Content-Type": "application/json" },
      data: { name: "Owner only", days: FREE_WEEK },
    });
    const { template } = await created.json();

    const dashboard = await (
      await request.get("/api/trains/schedule", {
        headers: { Cookie: outsider.cookieHeader },
      })
    ).json();

    const paint = await request.patch("/api/trains/schedule/days", {
      headers: {
        Cookie: outsider.cookieHeader,
        "Content-Type": "application/json",
      },
      data: {
        dates: [dashboard.today],
        conductorRule: { kind: "vs_top_n", topN: 10 },
        vipRule: null,
        sourceTemplateId: template.id,
      },
    });
    expect(paint.status()).toBe(404);
  });

  test("a member without trains:write cannot create a template", async ({
    request,
  }) => {
    const member = await setupOfficer(request, "member");

    const res = await request.post("/api/trains/rule-templates", {
      headers: {
        Cookie: member.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { name: "Not allowed", days: FREE_WEEK },
    });
    expect(res.status()).toBe(403);
  });
});
