import { readFileSync } from "node:fs";
import path from "node:path";

export function loadLastWarFixture(name: string): unknown {
  const filePath = path.join(
    process.cwd(),
    "src/tests/fixtures/lastwar",
    `${name}.json`,
  );
  return JSON.parse(readFileSync(filePath, "utf8"));
}
