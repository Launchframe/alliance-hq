import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { streamObjectToFile } from "@/lib/storage";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

describe("streamObjectToFile", () => {
  const key = "test/stream-object/sample.bin";
  const destDir = path.join(process.cwd(), ".data", "test-stream-dest");

  afterEach(() => {
    try {
      rmSync(path.join(LOCAL_ROOT, key), { force: true });
      rmSync(destDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("copies local storage object to destination and returns byte size", async () => {
    const sourcePath = path.join(LOCAL_ROOT, key);
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    const payload = Buffer.from("hello-stream-object");
    writeFileSync(sourcePath, payload);

    const destPath = path.join(destDir, "out.bin");
    const bytes = await streamObjectToFile(key, destPath);

    expect(bytes).toBe(payload.length);
    expect(existsSync(destPath)).toBe(true);
    expect(readFileSync(destPath).equals(payload)).toBe(true);
  });
});
