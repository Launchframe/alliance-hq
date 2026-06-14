import fs from "node:fs/promises";
import path from "node:path";

import {
  deleteR2Object,
  getR2Object,
  putR2Object,
  r2Configured,
} from "@/lib/storage/r2";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

function useLocalStorage(): boolean {
  return !r2Configured();
}

function localPath(storageKey: string): string {
  return path.join(LOCAL_ROOT, storageKey);
}

export async function putObject(
  storageKey: string,
  body: Buffer | Uint8Array,
): Promise<void> {
  if (useLocalStorage()) {
    const filePath = localPath(storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    return;
  }

  await putR2Object(storageKey, body);
}

export async function getObject(storageKey: string): Promise<Buffer> {
  if (useLocalStorage()) {
    return fs.readFile(localPath(storageKey));
  }
  return getR2Object(storageKey);
}

export async function deleteObject(storageKey: string): Promise<void> {
  if (useLocalStorage()) {
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

export { r2Configured, useLocalStorage };
