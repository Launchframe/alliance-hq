import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteObject, getObject, putObject } from "@/lib/storage";
import { sealStoredObject } from "./media-storage.server";

const keys: string[] = [];
beforeEach(() => vi.stubEnv("R2_BUCKET", ""));
afterEach(async () => { await Promise.all(keys.splice(0).map((key) => deleteObject(key))); vi.unstubAllEnvs(); });

async function source() {
  const allianceId = nanoid(), caseId = nanoid();
  const sourceKey = `ocr-staging/${allianceId}/${caseId}/source.mp4`;
  keys.push(sourceKey);
  const bytes = Buffer.from("original fixture pixels");
  await putObject(sourceKey, bytes);
  return { allianceId, caseId, sourceKey, bytes, expectedSha256: createHash("sha256").update(bytes).digest("hex"), maxBytes: 1000, extension: ".mp4" as const };
}

describe("sealed corpus objects", () => {
  it("keeps source bytes independent of overwrite and deletion in the job cache", async () => {
    const input = await source();
    const result = await sealStoredObject(input);
    keys.push(result.storageKey);
    expect(result.sha256).toBe(input.expectedSha256);
    expect(result.bytes).toBe(input.bytes.length);
    expect(result.storageKey).toMatch(new RegExp(`^ocr-learning/${input.allianceId}/${input.caseId}/`));
    await putObject(input.sourceKey, Buffer.from("replacement"));
    await deleteObject(input.sourceKey);
    expect(await getObject(result.storageKey)).toEqual(input.bytes);
  });

  it("refuses changed content and size overflow without producing a usable source", async () => {
    const input = await source();
    await expect(sealStoredObject({ ...input, expectedSha256: "b".repeat(64) })).rejects.toMatchObject({ code: "source_hash_mismatch" });
    await expect(sealStoredObject({ ...input, maxBytes: 1 })).rejects.toMatchObject({ code: "source_size_limit" });
  });

  it("refuses traversal, arbitrary local files and another tenant's staging key", async () => {
    const input = await source();
    for (const sourceKey of [".env.local", "ocr-staging/foreign/file.mp4", `ocr-staging/${input.allianceId}/../other.mp4`]) {
      await expect(sealStoredObject({ ...input, sourceKey })).rejects.toMatchObject({ code: "invalid_source_key" });
    }
  });
});
