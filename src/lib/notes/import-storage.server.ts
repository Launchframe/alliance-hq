import "server-only";

import { createHash } from "node:crypto";
import { getObjectStream, getObjectSize, r2Configured } from "@/lib/storage";
import { headR2ObjectMetadata } from "@/lib/storage/r2";
import { KnowledgeAccessError } from "./resources.server";

export const historyByteHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function assertHistoryStorage() {
  if (process.env.VERCEL && !r2Configured()) throw new KnowledgeAccessError("not_configured");
}
export async function readHistoryStream(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Buffer> {
  if (!stream) throw new KnowledgeAccessError("invalid");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 30_000);
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new KnowledgeAccessError("invalid"); }
      chunks.push(next.value);
    }
    if (timedOut) throw new KnowledgeAccessError("invalid");
    return Buffer.concat(chunks, size);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
export function validateHistoryBytes(bytes: Buffer, contentType: string) {
  const valid = contentType === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : contentType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : contentType === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
    : ["text/plain", "text/markdown", "application/json"].includes(contentType) && !new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0");
  if (!valid) throw new KnowledgeAccessError("invalid");
}
export async function readHistoryObject(key: string, size: number, contentType: string, sha256: string, staging = false) {
  assertHistoryStorage();
  if (staging && r2Configured()) {
    const metadata = await headR2ObjectMetadata(key);
    if (metadata.size !== size || metadata.contentType !== contentType) throw new KnowledgeAccessError("invalid");
  } else if (await getObjectSize(key) !== size) throw new KnowledgeAccessError("invalid");
  const bytes = await readHistoryStream(await getObjectStream(key, true), size);
  if (bytes.length !== size || historyByteHash(bytes) !== sha256) throw new KnowledgeAccessError("invalid");
  validateHistoryBytes(bytes, contentType);
  return bytes;
}
