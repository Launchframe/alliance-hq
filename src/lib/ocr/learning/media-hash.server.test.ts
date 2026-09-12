import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashVideoInput } from "./media-hash.server";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("bounded source digests", () => {
  it("hashes the input bytes and rejects overflow instead of hashing a prefix", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ocr-source-hash-"));
    directories.push(directory);
    const file = path.join(directory, "source.bin");
    const bytes = Buffer.from("original fixture bytes");
    await writeFile(file, bytes);
    expect(await hashVideoInput(file, bytes.length)).toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(hashVideoInput(file, bytes.length - 1)).rejects.toMatchObject({ code: "source_size_limit" });
  });

  it("rejects invalid budgets before opening a source", async () => {
    await expect(hashVideoInput("unused", Number.NaN)).rejects.toMatchObject({ code: "invalid_limit" });
    await expect(hashVideoInput("unused", 0)).rejects.toMatchObject({ code: "invalid_limit" });
  });
});
