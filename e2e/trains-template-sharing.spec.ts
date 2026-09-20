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

/** Tuesday reads Sunday once lead time is 1, so this warns at lead 1 only. */
const TUESDAY_VS_WEEK = {
  sun: { conductorRule: null, vipRule: { kind: "none" } },
  mon: { conductorRule: null, vipRule: { kind: "none" } },
  tue: { conductorRule: { kind: "vs_top_n", topN: 10 }, vipRule: null },
  wed: { conductorRule: { kind: "vs_top_n", topN: 10 }, vipRule: null },
  thu: { conductorRule: null, vipRule: { kind: "none" } },
  fri: { conductorRule: null, vipRule: { kind: "none" } },
  sat: { conductorRule: null, vipRule: { kind: "none" } },
};

type Fixture = { cookieHeader: string; allianceId: string; tag: string };

async function setupOfficer(
  request: APIRequestContext,
  options?: { leadDays?: number; roleName?: string },
): Promise<Fixture> {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `TS${nanoid(4)}`,
    name: "Template Sharing Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    uniqueEmail("template-share"),
  );
  await createAllianceMembership(sql, {
    hqUserId: auth.hqUserId,
    allianceId: alliance.allianceId,
    roleName: options?.roleName ?? "officer",
    source: "manual",
  });
  await createHqMemberLink(sql, {
    allianceId: alliance.allianceId,
    hqUserId: auth.hqUserId,
  });
  await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Template Share Roster Member",
  });
  if (options?.leadDays != null) {
    await sql`
      UPDATE alliances
      SET train_conductor_lead_time_days = ${options.leadDays}
      WHERE id = ${alliance.allianceId}
    `;
  }
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
    tag: alliance.tag,
  };
}

async function createTemplate(
  request: APIRequestContext,
  officer: Fixture,
  name: string,
  days: unknown = TUESDAY_VS_WEEK,
): Promise<{ id: string; name: string }> {
  const res = await request.post("/api/trains/rule-templates", {
    headers: { Cookie: officer.cookieHeader, "Content-Type": "application/json" },
    data: { name, days },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).template;
}

async function shareTemplate(
  request: APIRequestContext,
  officer: Fixture,
  templateId: string,
): Promise<string> {
  const res = await request.post(
    `/api/trains/rule-templates/${templateId}/share`,
    { headers: { Cookie: officer.cookieHeader } },
  );
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).code;
}

test.describe("Train template sharing", () => {
  test("another alliance can preview and import by code", async ({
    request,
  }) => {
    const author = await setupOfficer(request);
    const importer = await setupOfficer(request);
    const template = await createTemplate(request, author, "Shared push");
    const code = await shareTemplate(request, author, template.id);

    const preview = await request.get(
      `/api/trains/rule-templates/import?code=${encodeURIComponent(code)}`,
      { headers: { Cookie: importer.cookieHeader } },
    );
    expect(preview.ok(), await preview.text()).toBeTruthy();
    const previewBody = await preview.json();
    expect(previewBody.preview.name).toBe("Shared push");
    expect(previewBody.preview.sourceAllianceTag).toBe(author.tag);
    expect(previewBody.preview.alreadyImported).toBe(false);

    const imported = await request.post("/api/trains/rule-templates/import", {
      headers: {
        Cookie: importer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { code },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const { template: copy } = await imported.json();
    expect(copy.isPreset).toBe(false);
    expect(copy.sourceTemplateId).toBe(template.id);
    expect(copy.id).not.toBe(template.id);
    expect(copy.days.tue.conductorRule).toEqual({
      kind: "vs_top_n",
      topN: 10,
    });
  });

  test("the code is accepted with the spacing and case people retype", async ({
    request,
  }) => {
    const author = await setupOfficer(request);
    const importer = await setupOfficer(request);
    const template = await createTemplate(request, author, "Retyped");
    const code = await shareTemplate(request, author, template.id);

    const messy = ` ${code.slice(0, 4).toLowerCase()} ${code.slice(4)} `;
    const res = await request.get(
      `/api/trains/rule-templates/import?code=${encodeURIComponent(messy)}`,
      { headers: { Cookie: importer.cookieHeader } },
    );
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test("the import is a copy — later edits by the author do not follow", async ({
    request,
  }) => {
    const author = await setupOfficer(request);
    const importer = await setupOfficer(request);
    const template = await createTemplate(request, author, "Divergent");
    const code = await shareTemplate(request, author, template.id);

    const imported = await request.post("/api/trains/rule-templates/import", {
      headers: {
        Cookie: importer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { code },
    });
    const { template: copy } = await imported.json();

    await request.patch(`/api/trains/rule-templates/${template.id}`, {
      headers: {
        Cookie: author.cookieHeader,
        "Content-Type": "application/json",
      },
      data: {
        days: {
          ...TUESDAY_VS_WEEK,
          tue: { conductorRule: { kind: "donations_top" }, vipRule: null },
        },
      },
    });

    const after = await request.get("/api/trains/rule-templates", {
      headers: { Cookie: importer.cookieHeader },
    });
    const mine = (await after.json()).templates.find(
      (row: { id: string }) => row.id === copy.id,
    );
    expect(mine.days.tue.conductorRule).toEqual({
      kind: "vs_top_n",
      topN: 10,
    });
  });

  test("revoking the code stops new imports but keeps existing copies", async ({
    request,
  }) => {
    const author = await setupOfficer(request);
    const importer = await setupOfficer(request);
    const template = await createTemplate(request, author, "Revoked later");
    const code = await shareTemplate(request, author, template.id);

    const imported = await request.post("/api/trains/rule-templates/import", {
      headers: {
        Cookie: importer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { code },
    });
    expect(imported.status()).toBe(201);
    const { template: copy } = await imported.json();

    const revoke = await request.delete(
      `/api/trains/rule-templates/${template.id}/share`,
      { headers: { Cookie: author.cookieHeader } },
    );
    expect(revoke.ok(), await revoke.text()).toBeTruthy();

    const preview = await request.get(
      `/api/trains/rule-templates/import?code=${encodeURIComponent(code)}`,
      { headers: { Cookie: importer.cookieHeader } },
    );
    expect(preview.status()).toBe(404);

    const still = (
      await (
        await request.get("/api/trains/rule-templates", {
          headers: { Cookie: importer.cookieHeader },
        })
      ).json()
    ).templates.some((row: { id: string }) => row.id === copy.id);
    expect(still).toBe(true);
  });

  test("rotating the code invalidates the previous one", async ({ request }) => {
    const author = await setupOfficer(request);
    const importer = await setupOfficer(request);
    const template = await createTemplate(request, author, "Rotated");
    const first = await shareTemplate(request, author, template.id);
    const second = await shareTemplate(request, author, template.id);
    expect(second).not.toBe(first);

    expect(
      (
        await request.get(
          `/api/trains/rule-templates/import?code=${encodeURIComponent(first)}`,
          { headers: { Cookie: importer.cookieHeader } },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(
          `/api/trains/rule-templates/import?code=${encodeURIComponent(second)}`,
          { headers: { Cookie: importer.cookieHeader } },
        )
      ).ok(),
    ).toBeTruthy();
  });

  test("warnings are computed against the importer's lead time", async ({
    request,
  }) => {
    // Tuesday Top VS is sound at lead 0 and unsound at lead 1, so the same
    // seven rules must warn differently for author and importer.
    const author = await setupOfficer(request, { leadDays: 0 });
    const importer = await setupOfficer(request, { leadDays: 1 });
    const template = await createTemplate(request, author, "Lead sensitive");
    const code = await shareTemplate(request, author, template.id);

    const preview = await (
      await request.get(
        `/api/trains/rule-templates/import?code=${encodeURIComponent(code)}`,
        { headers: { Cookie: importer.cookieHeader } },
      )
    ).json();

    expect(preview.leadDays).toBe(1);
    expect(preview.warnings.map((w: { weekday: string }) => w.weekday)).toEqual(
      ["tue"],
    );
  });

  test("presets cannot be share-coded", async ({ request }) => {
    const officer = await setupOfficer(request);
    const templates = (
      await (
        await request.get("/api/trains/rule-templates", {
          headers: { Cookie: officer.cookieHeader },
        })
      ).json()
    ).templates;
    const preset = templates.find(
      (row: { presetKey: string | null }) => row.presetKey === "economy_week",
    );

    const res = await request.post(
      `/api/trains/rule-templates/${preset.id}/share`,
      { headers: { Cookie: officer.cookieHeader } },
    );
    expect(res.status()).toBe(403);
  });

  test("an unknown code is a 404, not a hint about what exists", async ({
    request,
  }) => {
    const importer = await setupOfficer(request);
    const res = await request.get(
      "/api/trains/rule-templates/import?code=ZZZZZZZZZZ",
      { headers: { Cookie: importer.cookieHeader } },
    );
    expect(res.status()).toBe(404);
  });

  test("a member without trains:write cannot share or import", async ({
    request,
  }) => {
    const author = await setupOfficer(request);
    const member = await setupOfficer(request, { roleName: "member" });
    const template = await createTemplate(request, author, "Member gated");
    const code = await shareTemplate(request, author, template.id);

    expect(
      (
        await request.post(`/api/trains/rule-templates/${template.id}/share`, {
          headers: { Cookie: member.cookieHeader },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.post("/api/trains/rule-templates/import", {
          headers: {
            Cookie: member.cookieHeader,
            "Content-Type": "application/json",
          },
          data: { code },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await request.get(
          `/api/trains/rule-templates/import?code=${encodeURIComponent(code)}`,
          { headers: { Cookie: member.cookieHeader } },
        )
      ).status(),
    ).toBe(403);
  });

  test("archiving a shared template revokes its code and clears the hint", async ({
    request,
  }) => {
    const author = await setupOfficer(request);
    const importer = await setupOfficer(request);
    const template = await createTemplate(request, author, "Shared then retired");
    const code = await shareTemplate(request, author, template.id);

    const imported = await request.post("/api/trains/rule-templates/import", {
      headers: {
        Cookie: importer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { code },
    });
    expect(imported.status()).toBe(201);
    const { template: copy } = await imported.json();

    const archived = await request.delete(
      `/api/trains/rule-templates/${template.id}`,
      { headers: { Cookie: author.cookieHeader } },
    );
    expect(archived.ok(), await archived.text()).toBeTruthy();

    expect(
      (
        await request.get(
          `/api/trains/rule-templates/import?code=${encodeURIComponent(code)}`,
          { headers: { Cookie: importer.cookieHeader } },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post("/api/trains/rule-templates/import", {
          headers: {
            Cookie: importer.cookieHeader,
            "Content-Type": "application/json",
          },
          data: { code },
        })
      ).status(),
    ).toBe(404);

    const authorList = (
      await (
        await request.get("/api/trains/rule-templates", {
          headers: { Cookie: author.cookieHeader },
        })
      ).json()
    ).templates as Array<{ id: string; shareCodeHint: string | null }>;
    const archivedRow = authorList.find((row) => row.id === template.id);
    expect(archivedRow?.shareCodeHint).toBeNull();

    const importerList = (
      await (
        await request.get("/api/trains/rule-templates", {
          headers: { Cookie: importer.cookieHeader },
        })
      ).json()
    ).templates;
    expect(
      importerList.some((row: { id: string }) => row.id === copy.id),
    ).toBe(true);
  });

  test("a second import of the same code is rejected as already imported", async ({
    request,
  }) => {
    const author = await setupOfficer(request);
    const importer = await setupOfficer(request);
    const template = await createTemplate(request, author, "Import me once");
    const code = await shareTemplate(request, author, template.id);

    const previewUrl = `/api/trains/rule-templates/import?code=${encodeURIComponent(code)}`;
    const before = await (
      await request.get(previewUrl, {
        headers: { Cookie: importer.cookieHeader },
      })
    ).json();
    expect(before.preview.alreadyImported).toBe(false);

    const imported = await request.post("/api/trains/rule-templates/import", {
      headers: {
        Cookie: importer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { code },
    });
    expect(imported.status()).toBe(201);

    const after = await (
      await request.get(previewUrl, {
        headers: { Cookie: importer.cookieHeader },
      })
    ).json();
    expect(after.preview.alreadyImported).toBe(true);

    const repeat = await request.post("/api/trains/rule-templates/import", {
      headers: {
        Cookie: importer.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { code, name: `Renamed ${nanoid(4)}` },
    });
    expect(repeat.status()).toBe(409);
    expect((await repeat.json()).code).toBe("already_imported");

    const selfImport = await request.post("/api/trains/rule-templates/import", {
      headers: {
        Cookie: author.cookieHeader,
        "Content-Type": "application/json",
      },
      data: { code, name: `Self copy ${nanoid(4)}` },
    });
    expect(selfImport.status()).toBe(409);
    expect((await selfImport.json()).code).toBe("already_imported");
  });
});
