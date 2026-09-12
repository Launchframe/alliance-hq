import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  copyR2ObjectBounded,
  deleteR2Object,
  getR2Object,
  getR2ObjectRange,
  getR2ObjectStream,
  headR2ObjectSize,
  putR2Object,
  r2Configured,
} from "@/lib/storage/r2";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

function prefersLocalStorage(): boolean {
  return !r2Configured();
}

function localPath(storageKey: string): string {
  return path.join(LOCAL_ROOT, storageKey);
}

export async function putObject(
  storageKey: string,
  body: Buffer | Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  if (prefersLocalStorage()) {
    const filePath = localPath(storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body, { signal });
    return;
  }

  await putR2Object(storageKey, body, signal);
}

export async function copyObjectBounded(sourceKey: string, destinationKey: string, maxBytes: number): Promise<void> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("object_size_limit");
  if ([sourceKey, destinationKey].some((key) => !/^[a-zA-Z0-9_./-]+$/.test(key) || key.split("/").some((part) => !part || part === "." || part === ".."))) throw new Error("invalid_object_key");
  if (!prefersLocalStorage()) return copyR2ObjectBounded(sourceKey, destinationKey, maxBytes);
  const root = await fs.realpath(LOCAL_ROOT);
  const source = localPath(sourceKey), destination = localPath(destinationKey);
  if (await fs.realpath(source) !== path.join(root, sourceKey)) throw new Error("invalid_source_key");
  const input = await fs.open(source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await input.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new RangeError("object_size_limit");
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (await fs.realpath(path.dirname(destination)) !== path.dirname(path.join(root, destinationKey))) throw new Error("invalid_object_key");
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new RangeError("object_size_limit") : null, chunk);
    } });
    await pipeline(input.createReadStream({ autoClose: false }), bounded, createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal: AbortSignal.timeout(60000) });
  } finally { await input.close(); }
}

export async function putLocalObjectStreamBounded(storageKey: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ bytes: number; sha256: string }> {
  if (!prefersLocalStorage() || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("invalid_stream_upload");
  if (!/^[a-zA-Z0-9_./-]+$/.test(storageKey) || storageKey.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("invalid_object_key");
  const destination = localPath(storageKey);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const root = await fs.realpath(LOCAL_ROOT);
  if (await fs.realpath(path.dirname(destination)) !== path.dirname(path.join(root, storageKey))) throw new Error("invalid_object_key");
  const hash = createHash("sha256");
  let bytes = 0, created = false;
  const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(new RangeError("object_size_limit"));
    hash.update(chunk);
    callback(null, chunk);
  } });
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  output.once("open", () => { created = true; });
  try {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), bounded, output, { signal: AbortSignal.timeout(60000) });
    return { bytes, sha256: hash.digest("hex") };
  } catch (error) {
    if (created) await fs.unlink(destination);
    throw error;
  }
}

export async function streamObjectToFile(
  storageKey: string,
  destPath: string,
  maxBytes?: number,
): Promise<number> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  if (maxBytes != null) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("object_size_limit");
    let bytes = 0;
    const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new RangeError("object_size_limit") : null, chunk);
    } });
    const signal = AbortSignal.timeout(60000);
    const stream = Readable.fromWeb(await getObjectStream(storageKey, undefined, signal) as import("node:stream/web").ReadableStream);
    await pipeline(stream, bounded, createWriteStream(destPath, { flags: "wx", mode: 0o600 }), { signal });
    return bytes;
  }

  if (prefersLocalStorage()) {
    await fs.copyFile(localPath(storageKey), destPath);
    const stat = await fs.stat(destPath);
    return stat.size;
  }

  const webStream = await getR2ObjectStream(storageKey);
  const nodeStream = Readable.fromWeb(
    webStream as import("node:stream/web").ReadableStream,
  );
  await pipeline(nodeStream, createWriteStream(destPath));
  const stat = await fs.stat(destPath);
  return stat.size;
}

export async function getObject(storageKey: string): Promise<Buffer> {
  if (prefersLocalStorage()) {
    return fs.readFile(localPath(storageKey));
  }
  return getR2Object(storageKey);
}

export async function getObjectStream(
  storageKey: string,
  range?: { start: number; end: number },
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start)) throw new RangeError("invalid_range");
  if (prefersLocalStorage()) {
    const stream = createReadStream(localPath(storageKey), { ...range, signal });
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  }
  return getR2ObjectStream(storageKey, range, signal);
}

export async function getObjectSize(storageKey: string, signal?: AbortSignal): Promise<number> {
  if (prefersLocalStorage()) {
    const stat = await fs.stat(localPath(storageKey));
    return stat.size;
  }
  return headR2ObjectSize(storageKey, signal);
}

export async function getObjectRange(
  storageKey: string,
  start: number,
  end: number,
): Promise<Buffer> {
  if (prefersLocalStorage()) {
    const length = end - start + 1;
    const buffer = Buffer.alloc(length);
    const handle = await fs.open(localPath(storageKey), "r");
    try {
      await handle.read(buffer, 0, length, start);
      return buffer;
    } finally {
      await handle.close();
    }
  }
  return getR2ObjectRange(storageKey, start, end);
}

export async function deleteObject(storageKey: string, signal?: AbortSignal): Promise<void> {
  if (prefersLocalStorage()) {
    try {
      await fs.unlink(localPath(storageKey));
    } catch {
      /* ignore */
    }
    return;
  }
  await deleteR2Object(storageKey, signal);
}

export function videoStorageKey(jobId: string, fileName: string): string {
  const ext = path.extname(fileName) || ".mp4";
  return `videos/${jobId}/source${ext}`;
}

export function frameStorageKey(jobId: string, index: number): string {
  return `videos/${jobId}/frames/${String(index).padStart(4, "0")}.jpg`;
}

export function archiveStorageKey(jobId: string): string {
  return `videos/${jobId}/archive.mp4`;
}

export { prefersLocalStorage, r2Configured };
