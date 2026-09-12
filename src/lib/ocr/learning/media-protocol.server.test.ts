import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { deleteObject, getObject, putLocalObjectStreamBounded, putObject } from "@/lib/storage";
import { presignR2PutObjectBounded, resetR2ClientForTests } from "@/lib/storage/r2";
import { readPngFrames } from "./png-stream.server";

const keys: string[] = [];
beforeEach(() => { vi.stubEnv("R2_BUCKET", ""); resetR2ClientForTests(); });
afterEach(async () => { vi.stubEnv("R2_BUCKET", ""); await Promise.all(keys.splice(0).map((key) => deleteObject(key))); resetR2ClientForTests(); vi.unstubAllEnvs(); });

async function collect(stream: AsyncIterable<Uint8Array>, count = 4, limit = 10000) {
  const result: Buffer[] = [];
  for await (const frame of readPngFrames(stream, count, limit)) result.push(frame);
  return result;
}

async function* chunks(bytes: Buffer) { for (let offset = 0; offset < bytes.length; offset += 7) yield bytes.subarray(offset, offset + 7); }

function body(bytes: Buffer) { return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }); }

describe("bounded media transport", () => {
  it("extracts complete PNGs across arbitrary chunk boundaries and rejects partial or excessive output", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123456" } }).png().toBuffer();
    expect(await collect(chunks(Buffer.concat([png, png])))).toEqual([png, png]);
    await expect(collect(chunks(png.subarray(0, png.length - 1)))).rejects.toMatchObject({ code: "incomplete_frame_stream" });
    await expect(collect(chunks(Buffer.concat([png, png])), 1)).rejects.toMatchObject({ code: "frame_count_limit" });
    await expect(collect(chunks(png), 4, 16)).rejects.toMatchObject({ code: "frame_size_limit" });
  });

  it("bounds local uploads and never deletes an existing destination on a retry", async () => {
    const key = `ocr-staging/${nanoid()}/${nanoid()}/source.png`;
    keys.push(key);
    const original = Buffer.from("fixture");
    const result = await putLocalObjectStreamBounded(key, body(original), original.length);
    expect(result.bytes).toBe(original.length);
    await expect(putLocalObjectStreamBounded(key, body(Buffer.from("replacement")), 100)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await getObject(key)).toEqual(original);
    const overflow = `ocr-staging/${nanoid()}/${nanoid()}/source.png`;
    keys.push(overflow);
    await expect(putLocalObjectStreamBounded(overflow, body(original), 1)).rejects.toThrow("object_size_limit");
    await expect(getObject(overflow)).rejects.toMatchObject({ code: "ENOENT" });
    await putObject(overflow, original);
  });

  it("signs the declared byte length so an upload cannot exceed its reservation", async () => {
    vi.stubEnv("R2_BUCKET", "fixture-bucket");
    vi.stubEnv("R2_ACCOUNT_ID", "fixture-account");
    vi.stubEnv("R2_ACCESS_KEY_ID", "fixture-access");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "fixture-secret");
    const url = new URL(await presignR2PutObjectBounded("ocr-staging/a/b/source.png", "image/png", 123));
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(expect.arrayContaining(["content-length", "content-type"]));
  });
});
