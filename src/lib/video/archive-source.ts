import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

function resolveFfmpegBinary(): string {
  if (ffmpegStatic) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

export async function transcodeVideoArchive(
  sourcePath: string,
  destPath: string,
): Promise<void> {
  const ffmpeg = resolveFfmpegBinary();
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  await execFileAsync(
    ffmpeg,
    [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      "scale=-2:min(720\\,ih)",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      destPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

export async function transcodeVideoArchiveToTemp(
  sourcePath: string,
  jobId: string,
): Promise<string> {
  const destPath = path.join(os.tmpdir(), `hq-video-archive-${jobId}.mp4`);
  await transcodeVideoArchive(sourcePath, destPath);
  return destPath;
}
