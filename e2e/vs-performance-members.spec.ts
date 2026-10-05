import { expect, test, type Page } from "@playwright/test";

import { playwrightAuthCookies } from "./fixtures/db";
import { setupVsMembersFixture, type VsMembersActor } from "./fixtures/vs-members";

type Actor = VsMembersActor;

async function openPage(page: Page, actor: Actor, path = "") {
  await page.context().addCookies(playwrightAuthCookies(actor));
  await page.goto(`/vs-performance${path}`);
}

test("officer member table shows statuses, filters, sorts, and pagination", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await openPage(page, officer, `?week=${f.weekStart}`);

  const section = page.getByTestId("vs-members-section");
  await expect(section.getByRole("heading", { name: "Member performance" })).toBeVisible();
  const table = page.getByTestId("vs-members-table");
  await expect(table).toBeVisible();

  const rowFor = (name: string) => table.getByRole("row").filter({ hasText: name });
  await expect(table.locator("thead th")).toHaveText([
    "Member",
    "Rank",
    "Performance status",
    "Rank outlook",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
    "Total",
    "Days meeting minimum",
  ]);

  await expect(rowFor("VSM Meeting")).toContainText("Meeting expectations");
  await expect(rowFor("VSM Below")).toContainText("Below minimum");
  await expect(rowFor("VSM Zero")).toContainText("No participation");
  await expect(rowFor("VSM Missing")).toContainText("Needs evidence");
  await expect(rowFor("VSM Excused")).toContainText("Partly excused");

  // Day cells expose a full accessible label via sr-only text.
  await expect(
    rowFor("VSM Meeting").locator("td").nth(4).locator(".sr-only"),
  ).toHaveText(/Mon: Met minimum/);
  await expect(
    rowFor("VSM Excused").locator("td").nth(9).locator(".sr-only"),
  ).toHaveText(/Sat: Excused/);

  // Filter by status updates URL and rows.
  await section.getByRole("button", { name: "Performance status" }).click();
  await page.getByRole("option", { name: "Below minimum" }).click();
  await expect(page).toHaveURL(/status=below/);
  await expect(rowFor("VSM Below")).toBeVisible();
  await expect(rowFor("VSM Meeting")).toHaveCount(0);

  // Clear filters restores all five rows.
  await section.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(table.getByRole("row")).toHaveCount(6); // header + 5

  // Sort by Total via header sets aria-sort.
  await table.getByRole("button", { name: "Total" }).click();
  await expect(page).toHaveURL(/sort=total/);
  await expect(table.locator("th", { hasText: "Total" })).toHaveAttribute("aria-sort", "descending");
  await expect(table.getByRole("row").nth(1)).toContainText("VSM");

  // Reload restores filters from the URL.
  await page.reload();
  await expect(table.getByRole("button", { name: "Total" })).toBeVisible();
  await expect(table.locator("th", { hasText: "Total" })).toHaveAttribute("aria-sort", "descending");

  // Page size select is wired to the URL.
  await section.getByRole("button", { name: "Rows per page" }).click();
  await page.getByRole("option", { name: "100", exact: true }).click();
  await expect(page).toHaveURL(/pageSize=100/);
  await expect(page.getByTestId("vs-members-showing")).toContainText("5");
});

test("member role keeps the page but cannot see the member table or the API", async ({ page, request }) => {
  const f = await setupVsMembersFixture();
  const member = await f.actor("member");
  await openPage(page, member, `?week=${f.weekStart}`);
  await expect(page.getByRole("heading", { name: /Week of/ })).toBeVisible();
  await expect(page.getByTestId("vs-members-section")).toHaveCount(0);
  const res = await request.get(`/api/vs-performance/members?weekStart=${f.weekStart}`, { headers: member.headers });
  expect(res.status()).toBe(403);
});

test("pt-BR localizes the member table", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await page.context().addCookies(playwrightAuthCookies(officer));
  await page.goto(`/pt-BR/vs-performance?week=${f.weekStart}`);
  const table = page.getByTestId("vs-members-table");
  await expect(table).toBeVisible();
  await expect(page.getByTestId("vs-members-section")).toContainText("Desempenho dos membros");
  await expect(table.getByRole("row").filter({ hasText: "VSM Meeting" })).toContainText("Cumprindo as expectativas");
});

test("changing the week resets pagination to page 1 while keeping filters", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await openPage(page, officer, `?week=${f.weekStart}&status=meeting&page=2`);

  await expect(page.getByTestId("vs-members-table")).toBeVisible();
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(page).not.toHaveURL(/page=/);
  await expect(page).toHaveURL(/status=meeting/);
});

test("member table stays inside a scroll container at 390px and renders in dark theme", async ({ page }) => {
  const f = await setupVsMembersFixture();
  const officer = await f.actor("officer");
  await page.setViewportSize({ width: 390, height: 800 });
  await openPage(page, officer, `?week=${f.weekStart}`);
  await expect(page.getByTestId("vs-members-table")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("vs-members-table")).toBeVisible();
  const fg = await page.getByTestId("vs-members-table").evaluate((el) => getComputedStyle(el).color);
  expect(fg).not.toBe("rgb(0, 0, 0)");
});
