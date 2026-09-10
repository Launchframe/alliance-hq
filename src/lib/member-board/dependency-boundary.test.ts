import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps the reusable member-board modules free of domain imports, endpoints, permission and translation assumptions", () => {
  for (const directory of ["src/lib/member-board", "src/components/member-board"]) {
    for (const name of readdirSync(resolve(directory)).filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))) {
      const source = readFileSync(resolve(directory, name), "utf8");
      expect(source, `${directory}/${name}`).not.toMatch(/support.?teams|supportTeams|\/api\/|canWrite|leadId|rank\s*===|useTranslations|next-intl/i);
    }
  }
});
