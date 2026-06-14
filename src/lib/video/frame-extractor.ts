import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

import { logPipelineStep } from "@/lib/video/pipeline-step-log";

const execFileAsync = promisify(execFile);

export type ExtractedFrame = {
  index: number;
  filePath: string;
  buffer: Buffer;
};

function resolveFfmpegBinary(): string {
  if (ffmpegStatic) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync(resolveFfmpegBinary(), ["-version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract frames from video using ffmpeg scene detection.
 * Falls back to 1 fps if scene filter yields nothing.
 */
export async function extractLeaderboardFrames(
  videoPath: string,
  sampleFps = 1,
): Promise<ExtractedFrame[]> {
  if (!(await ffmpegAvailable())) {
    throw new Error(
      "ffmpeg is not installed. Install ffmpeg to process videos locally.",
    );
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hq-frames-"));
  const pattern = path.join(tmpDir, "frame_%04d.jpg");

  const ffmpeg = resolveFfmpegBinary();

  const sceneStarted = Date.now();
  try {
    await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-vf",
        `select='gt(scene,0.25)',scale=720:-1`,
        "-vsync",
        "vfr",
        pattern,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    logPipelineStep("ffmpeg.scene_detect", Date.now() - sceneStarted, {
      mode: "scene",
    });
  } catch {
    const fallbackStarted = Date.now();
    await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        videoPath,
        "-vf",
        `fps=${sampleFps},scale=720:-1`,
        pattern,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    logPipelineStep("ffmpeg.fps_fallback", Date.now() - fallbackStarted, {
      fps: sampleFps,
    });
  }

  const files = (await fs.readdir(tmpDir))
    .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
    .sort();

  if (files.length === 0) {
    throw new Error("No frames extracted from video.");
  }

  const readStarted = Date.now();
  const frames: ExtractedFrame[] = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(tmpDir, files[i]!);
    const buffer = await fs.readFile(filePath);
    frames.push({ index: i, filePath, buffer });
  }
  logPipelineStep("ffmpeg.read_frames", Date.now() - readStarted, {
    frameCount: frames.length,
  });

  return frames;
}

export async function cleanupFrameTempDir(frames: ExtractedFrame[]) {
  if (frames.length === 0) return;
  const dir = path.dirname(frames[0]!.filePath);
  await fs.rm(dir, { recursive: true, force: true });
}
