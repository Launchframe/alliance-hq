import { expect, it, vi } from "vitest";
import { loadSupportRoster, loadSupportStints, type SupportReader } from "./roster.server";

function database(results: unknown[][]) {
  const select = vi.fn(() => {
    const rows = results.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "leftJoin", "innerJoin"]) chain[method] = () => chain;
    chain.then = (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
    return chain;
  });
  return { db: { select } as unknown as SupportReader, select };
}
it("projects UID-safe optional links and keeps THP distinct from base power", async () => {
  const { db, select } = database([
    [{ id: "unlinked", name: "Lead", previousNames: ["Alias"], rank: 4, country: "br", professionLevel: 0, baseLevel: 30, basePower: "1.2B", kills: null, thp: 80_000_000, gameUid: "not-projectable", notes: "not-projectable" }],
    [{ memberId: "unlinked", joinedAt: new Date("2026-09-08T00:00:00Z") }], [], [], [{ memberId: "unlinked" }],
  ]);
  const [member] = await loadSupportRoster("alliance", db, Date.parse("2026-09-10T00:00:00Z"));
  expect(member).toMatchObject({ id: "unlinked", rank: 4, country: "BR", professionLevel: 0, basePower: 1_200_000_000, thp: 80_000_000, tenureDays: 2, hqLinked: false, discordLinked: true });
  expect(member).not.toHaveProperty("gameUid");
  expect(member).not.toHaveProperty("notes");
  for (const [projection] of select.mock.calls as unknown as [Record<string, unknown>][]) {
    expect(Object.keys(projection)).not.toContain("gameUid");
  }
});
it("derives stint identity from trusted tenure records, not generic updates or rounded tenure days", async () => {
  const joinedAt = new Date("2026-09-08T00:00:00Z");
  const stint = { id: "tenure-one", memberId: "member", joinedAt, leftAt: null, updatedAt: joinedAt };
  const initial = await loadSupportStints("alliance", database([[stint], []]).db);
  expect(await loadSupportStints("alliance", database([[{ ...stint, updatedAt: new Date("2026-09-09T00:00:00Z") }], []]).db)).toEqual(initial);
  expect(await loadSupportStints("alliance", database([[{ ...stint, id: "tenure-two" }], []]).db)).not.toEqual(initial);
  expect(await loadSupportStints("alliance", database([[{ ...stint, leftAt: joinedAt }], [{ ...stint, status: "active" }]]).db)).toEqual({});
  expect(await loadSupportStints("alliance", database([[stint, { ...stint, id: "ambiguous" }], []]).db)).toEqual({});
  expect(await loadSupportStints("alliance", database([[{ ...stint, leftAt: new Date("2026-09-10T00:00:00Z") }, { ...stint, id: "overlap" }], []]).db)).toEqual({});
});
it("uses canonical membership starts for UID-less members and fails closed for missing proof", async () => {
  const membership = { id: "membership", memberId: "member", joinedAt: new Date("2026-09-08T00:00:00Z"), leftAt: null, status: "active" };
  const initial = await loadSupportStints("alliance", database([[], [membership]]).db);
  expect(initial.member).toMatch(/^[a-f0-9]{64}$/);
  expect(await loadSupportStints("alliance", database([[], [{ ...membership, joinedAt: new Date("2026-09-08T01:00:00Z") }]]).db)).not.toEqual(initial);
  expect(await loadSupportStints("alliance", database([[], [{ ...membership, status: "former" }]]).db)).toEqual({});
  expect(await loadSupportStints("alliance", database([[], []]).db)).toEqual({});
});
it("preserves unknown stats and unknown current stint for unlinked roster members", async () => {
  const { db } = database([[{ id: "member", name: "Member", rank: 3, country: "??", basePower: "unknown", previousNames: null }], [], [], [], []]);
  expect(await loadSupportRoster("alliance", db)).toEqual([{ id: "member", name: "Member", previousNames: [], rank: 3, country: null, professionLevel: null, baseLevel: null, basePower: null, kills: null, thp: null, tenureDays: null, hqLinked: false, discordLinked: false }]);
});
