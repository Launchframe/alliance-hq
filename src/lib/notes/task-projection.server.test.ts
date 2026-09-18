import { afterAll, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { assertE2eDatabaseUrl } from "../../../scripts/e2e-database-url-guard.mjs";
import { schema } from "@/lib/db";
import { listBoardNoteTasks } from "./tasks.server";
import { redactIntakeText } from "./intake.shared";
import type { KnowledgeActor } from "./policy.shared";
import type { KnowledgeTransaction } from "./resources.server";

const actor: KnowledgeActor = { kind: "web", allianceId: "alliance", hqUserId: "author", discordUserId: null, isOfficer: true, readableBoardIds: ["board"], editableBoardIds: [] };
async function selection(compact: boolean) {
  const query = { from: vi.fn(), innerJoin: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn().mockResolvedValue([]) };
  for (const key of ["from", "innerJoin", "leftJoin", "where", "orderBy"] as const) query[key].mockReturnValue(query);
  const select = vi.fn().mockReturnValue(query);
  await listBoardNoteTasks({ select } as unknown as KnowledgeTransaction, actor, "board", ["task"], compact);
  return select.mock.calls[0][0] as { task: Record<string, unknown>; sourceBody: unknown };
}
it("bounds compact task/source reads and excludes provenance before DTO mapping", async () => {
  const fields = await selection(true), dialect = new PgDialect();
  expect(fields.task).not.toBe(schema.officerActionItems);
  expect(dialect.sqlToQuery(fields.task.description as SQL).sql).toContain("1024");
  expect(dialect.sqlToQuery(fields.task.intakeProvenance as SQL).sql).toBe("null");
  expect(dialect.sqlToQuery(fields.sourceBody as SQL).sql).toContain("1024");
});
it("keeps full legacy/detail projection semantics", async () => {
  const fields = await selection(false);
  expect(fields.task).toBe(schema.officerActionItems);
  expect(fields.sourceBody).toBe(schema.performanceNotes.body);
});
const url = process.env.E2E_DATABASE_URL;
if (url) assertE2eDatabaseUrl(url);
const client = url ? postgres(url, { max: 1 }) : null;
afterAll(async () => { await client?.end(); });
it.skipIf(!client)("does not expose partial identifiers after a truncated credential is redacted", async () => {
  const fields = await selection(true), dialect = new PgDialect();
  for (const suffix of ["1".repeat(14), "eyJ" + "a".repeat(40) + "." + "b".repeat(30) + "." + "c".repeat(30)]) {
    const input = "token=" + "x".repeat(1008) + " " + suffix;
    const query = dialect.sqlToQuery(sql`select ${fields.task.description as SQL} as value from (values (${input})) as officer_action_items(description)`);
    const [row] = await client!.unsafe<{ value: string }[]>(query.sql, query.params as string[]);
    expect(row.value.length).toBeLessThanOrEqual(1024);
    const redacted = redactIntakeText(row.value);
    expect(redacted).not.toContain("11111");
    expect(redacted).not.toContain("eyJ");
    expect(redacted).not.toContain("xxxxx");
  }
});
