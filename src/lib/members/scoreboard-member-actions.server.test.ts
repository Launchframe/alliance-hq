import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards the dual-write ordering invariant: Ashed HTTP must not run inside an
 * open DB transaction (rollback after Ashed success orphans/duplicates members
 * or permanently diverges names).
 */
describe("scoreboard Ashed dual-write source invariant", () => {
  it("does not invoke Ashed create/rename helpers inside db.transaction callbacks", () => {
    const source = readFileSync(
      new URL("./scoreboard-member-actions.server.ts", import.meta.url),
      "utf8",
    );

    const ashedCallsInsideTx: string[] = [];
    const txStack: number[] = [];
    let depth = 0;

    for (const line of source.split("\n")) {
      if (line.includes(".transaction(")) {
        txStack.push(depth);
      }
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      while (txStack.length > 0 && depth <= txStack[txStack.length - 1]!) {
        txStack.pop();
      }
      if (txStack.length === 0) continue;
      if (
        line.includes("createAshedMember(") ||
        line.includes("syncMemberNameToAshed(") ||
        line.includes("base44EntityPost(") ||
        line.includes("base44ListMembers(")
      ) {
        ashedCallsInsideTx.push(line.trim());
      }
    }

    expect(ashedCallsInsideTx).toEqual([]);
    // Positive controls: helpers still exist outside transactions.
    expect(source).toContain("createAshedMember(");
    expect(source).toContain("syncMemberNameToAshed(");
  });
});
