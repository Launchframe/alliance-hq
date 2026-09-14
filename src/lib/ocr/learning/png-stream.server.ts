import "server-only";

import { OcrLearningError } from "../benchmark/types.shared";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export async function* readPngFrames(stream: AsyncIterable<Uint8Array>, maxFrames: number, maxFrameBytes: number): AsyncGenerator<Buffer> {
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || !Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 8) throw new OcrLearningError("invalid_media_limit");
  let buffer = Buffer.alloc(0), position = 8, count = 0;
  for await (const chunk of stream) {
    if (chunk.byteLength > maxFrameBytes) throw new OcrLearningError("frame_size_limit");
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 8) {
      if (!buffer.subarray(0, 8).equals(signature)) throw new OcrLearningError("invalid_frame_stream");
      let complete = false;
      while (position + 8 <= buffer.length) {
        const size = buffer.readUInt32BE(position), type = buffer.toString("ascii", position + 4, position + 8);
        const end = position + size + 12;
        if (end > maxFrameBytes) throw new OcrLearningError("frame_size_limit");
        if (end > buffer.length) break;
        position = end;
        if (type === "IEND") {
          if (size !== 0 || ++count > maxFrames) throw new OcrLearningError("frame_count_limit");
          yield Buffer.from(buffer.subarray(0, end));
          buffer = buffer.subarray(end);
          position = 8;
          complete = true;
          break;
        }
      }
      if (!complete) break;
    }
    if (buffer.length > maxFrameBytes) throw new OcrLearningError("frame_size_limit");
  }
  if (buffer.length || !count) throw new OcrLearningError("incomplete_frame_stream");
}
