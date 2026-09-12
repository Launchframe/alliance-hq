import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { OcrLearningError } from "../benchmark/types.shared";

export async function hashVideoInput(filePath: string, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new OcrLearningError("invalid_limit");
  const stream = createReadStream(filePath);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) throw new OcrLearningError("source_size_limit");
      hash.update(buffer);
    }
    return hash.digest("hex");
  } finally { stream.destroy(); }
}
