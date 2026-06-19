import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import {
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
): Promise<void> {
  if (prefersLocalStorage()) {
    const filePath = localPath(storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    return;
  }

  await putR2Object(storageKey, body);
}

export async function getObject(storageKey: string): Promise<Buffer> {
  if (prefersLocalStorage()) {
    return fs.readFile(localPath(storageKey));
  }
  return getR2Object(storageKey);
}

export async function getObjectStream(
  storageKey: string,
): Promise<ReadableStream<Uint8Array>> {
  if (prefersLocalStorage()) {
    const stream = createReadStream(localPath(storageKey));
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  }
  return getR2ObjectStream(storageKey);
}

export async function getObjectSize(storageKey: string): Promise<number> {
  if (prefersLocalStorage()) {
    const stat = await fs.stat(localPath(storageKey));
    return stat.size;
  }
  return headR2ObjectSize(storageKey);
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

export async function deleteObject(storageKey: string): Promise<void> {
  if (prefersLocalStorage()) {
    try {
      await fs.unlink(localPath(storageKey));
    } catch {
      /* ignore */
    }
    return;
  }
  await deleteR2Object(storageKey);
}

export function videoStorageKey(jobId: string, fileName: string): string {
  const ext = path.extname(fileName) || ".mp4";
  return `videos/${jobId}/source${ext}`;
}

export function frameStorageKey(jobId: string, index: number): string {
  return `videos/${jobId}/frames/${String(index).padStart(4, "0")}.jpg`;
}

export { prefersLocalStorage, r2Configured };
