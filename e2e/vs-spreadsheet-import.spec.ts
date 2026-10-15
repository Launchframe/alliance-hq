import { randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { nanoid } from "nanoid";

import {
  createAllianceMembership,
  createAllianceRosterMember,
  createAuthenticatedHqSession,
  createHqMemberLink,
  createNativeAlliance,
  getE2eSql,
  playwrightAuthCookies,
} from "./fixtures/db";

const WEEKLY_SUNDAY = "2026-10-04";

async function buildWeeklyXlsx(
  rows: Array<{ rank: number; name: string; score: number }>,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Weekly");
  sheet.getCell("A1").value = "VS Weekly Report - Week of 2026-09-28";
  sheet.getCell("A2").value = `${WEEKLY_SUNDAY}  16:11   •   ${rows.length} players`;
  sheet.getCell("A4").value = "Rank";
  sheet.getCell("B4").value = "Name";
  sheet.getCell("C4").value = "Points";
  rows.forEach((row, index) => {
    const r = index + 5;
    sheet.getCell(`A${r}`).value = row.rank;
    sheet.getCell(`B${r}`).value = row.name;
    sheet.getCell(`C${r}`).value = row.score;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function setupAlliance(roleName: "officer" | "member") {
  const sql = getE2eSql();
  const alliance = await createNativeAlliance(sql, {
    tag: `SS${nanoid(4)}`,
    name: "VS Spreadsheet Alliance",
  });
  const auth = await createAuthenticatedHqSession(
    sql,
    `ss-${roleName}-${randomBytes(4).toString("hex")}@e2e.test`,
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
  await sql`
    UPDATE sessions
    SET current_alliance_id = ${alliance.allianceId},
        alliance_id = ${alliance.allianceId},
        alliance_tag = ${alliance.tag}
    WHERE id = ${auth.sessionId}
  `;
  const matched = await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "Alpha Commander",
    allianceRank: 4,
  });
  const special = await createAllianceRosterMember(sql, {
    allianceId: alliance.allianceId,
    currentName: "ʳʰᶦⁿᵒ",
    allianceRank: 3,
  });
  const cookies = playwrightAuthCookies({
    sessionId: auth.sessionId,
    nextAuthToken: auth.nextAuthToken,
  });
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  return {
    sql,
    alliance,
    auth,
    matched,
    special,
    cookies,
    cookieHeader,
  };
}

test("officer imports a weekly spreadsheet through the review page and saves scores", async ({
  page,
  request,
}) => {
  const f = await setupAlliance("officer");
  const buffer = await buildWeeklyXlsx([
    { rank: 1, name: "Alpha Commander", score: 12_000_000 },
    { rank: 2, name: "ʳʰᶦⁿᵒ", score: 9_500_000 },
    { rank: 3, name: "Unknown Snapz", score: 1_000_000 },
  ]);

  const importRes = await request.post(
    "/api/vs-performance/spreadsheet-import",
    {
      headers: { Cookie: f.cookieHeader },
      multipart: {
        file: {
          name: "Weekly Total - 2026-10-03.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer,
        },
        period: "weekly",
        recordedDate: WEEKLY_SUNDAY,
      },
    },
  );
  expect(importRes.status()).toBe(200);
  const imported = (await importRes.json()) as {
    jobId: string;
    matchedCount: number;
    rowCount: number;
  };
  expect(imported.jobId).toBeTruthy();
  expect(imported.rowCount).toBe(3);
  expect(imported.matchedCount).toBe(2);

  // Soft-delete the unmatched row so submit can proceed.
  const [unmatched] = await f.sql`
    SELECT id FROM parsed_rows
    WHERE parse_session_id = (
      SELECT parse_session_id FROM video_jobs WHERE id = ${imported.jobId}
    )
      AND ocr_name = 'Unknown Snapz'
  `;
  expect(unmatched?.id).toBeTruthy();
  await f.sql`UPDATE parsed_rows SET deleted = 1 WHERE id = ${unmatched.id}`;

  await page.context().addCookies(f.cookies);
  await page.goto(`/tools/video-upload/${imported.jobId}/review`);
  await expect(page.getByTestId("vs-spreadsheet-source")).toContainText(
    "Weekly Total - 2026-10-03.xlsx",
  );

  const save = page.getByRole("button", { name: /Save \d+ scores/ });
  await expect(save).toBeEnabled({ timeout: 15_000 });
  await save.click();
  await expect(
    page.getByText(/Saved \d+ VS scores in Alliance HQ/),
  ).toBeVisible({ timeout: 20_000 });

  const heads = await f.sql`
    SELECT member_id, score::text AS score
    FROM vs_score_heads
    WHERE alliance_id = ${f.alliance.allianceId}
      AND recorded_date = ${WEEKLY_SUNDAY}
      AND period = 'weekly'
      AND score IS NOT NULL
    ORDER BY score::numeric DESC
  `;
  expect(heads).toHaveLength(2);
  expect(heads[0]?.member_id).toBe(f.matched.ashedMemberId);
  expect(heads[0]?.score).toBe("12000000");
  expect(heads[1]?.member_id).toBe(f.special.ashedMemberId);
  expect(heads[1]?.score).toBe("9500000");
});

test("member role cannot open spreadsheet import or call the API", async ({
  page,
  request,
}) => {
  const f = await setupAlliance("member");
  const denied = await request.post(
    "/api/vs-performance/spreadsheet-import",
    {
      headers: { Cookie: f.cookieHeader },
      multipart: {
        file: {
          name: "weekly.csv",
          mimeType: "text/csv",
          buffer: Buffer.from(
            "Rank,Name,Points\n1,Alpha Commander,100\n2,Other,90\n",
          ),
        },
        period: "weekly",
        recordedDate: WEEKLY_SUNDAY,
      },
    },
  );
  expect(denied.status()).toBe(403);

  await page.context().addCookies(f.cookies);
  await page.goto("/vs-performance");
  await expect(page.getByTestId("vs-spreadsheet-import-open")).toHaveCount(0);
});

test("officer sees the import button on the VS page", async ({ page }) => {
  const f = await setupAlliance("officer");
  await page.context().addCookies(f.cookies);
  await page.goto("/vs-performance");
  await expect(page.getByTestId("vs-spreadsheet-import-open")).toBeVisible();
  await page.getByTestId("vs-spreadsheet-import-open").click();
  await expect(page.getByTestId("vs-spreadsheet-import-dialog")).toBeVisible();
  await expect(page.getByTestId("vs-spreadsheet-import-file")).toBeVisible();
});
