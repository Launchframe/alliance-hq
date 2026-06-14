import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const NATIVE_DIALOG_PATTERN = /\bwindow\.(alert|confirm)\s*\(/;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectSourceFiles(fullPath, acc);
      continue;
    }
    if (/\.(tsx?|jsx?|mjs|cjs)$/.test(name)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

describe("no native browser dialogs", () => {
  it("does not use window.alert or window.confirm under src/", () => {
    const srcRoot = path.join(process.cwd(), "src");
    const offenders = collectSourceFiles(srcRoot).filter((filePath) =>
      NATIVE_DIALOG_PATTERN.test(readFileSync(filePath, "utf8")),
    );

    expect(offenders.map((filePath) => path.relative(process.cwd(), filePath))).toEqual(
      [],
    );
  });
});
