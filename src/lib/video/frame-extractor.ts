import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

import { logPipelineStep } from "@/lib/video/pipeline-step-log";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";
import {
  computeFramesSkipped,
  estimateDenseFrameCount,
} from "@/lib/video/pipeline-stats-display";

const execFileAsync = promisify(execFile);

export type ExtractedFrame = {
  index: number;
  filePath: string;
  buffer: Buffer;
};

export type ExtractLeaderboardFramesResult = {
  frames: ExtractedFrame[];
  videoDurationSeconds: number | null;
  denseFrameCount: number | null;
  framesSkipped: number | null;
};

/**
 * Probe a video file with ffprobe to get its duration in seconds.
 * Returns null if ffprobe-static is not available or the probe fails.
 */
export async function probeVideoDurationSeconds(
  videoPath: string,
): Promise<number | null> {
  let ffprobePath: string;
  try {
    const ffprobeStatic = await import("ffprobe-static");
    ffprobePath = (ffprobeStatic as unknown as { path: string }).path ?? (ffprobeStatic.default as unknown as { path: string })?.path;
    if (!ffprobePath) return null;
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const args = [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      videoPath,
    ];

    const proc = spawn(ffprobePath, args);
    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{ duration?: string; codec_type?: string }>;
        };
        const fromFormat = parsed.format?.duration
          ? parseFloat(parsed.format.duration)
          : null;
        if (Number.isFinite(fromFormat) && fromFormat! > 0) {
          resolve(fromFormat);
          return;
        }
        const videoStream = parsed.streams?.find(
          (s) => s.codec_type === "video" && s.duration,
        );
        const fromStream = videoStream?.duration
          ? parseFloat(videoStream.duration)
          : null;
        resolve(Number.isFinite(fromStream) && fromStream! > 0 ? fromStream : null);
      } catch {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

export type FrameExtractMode = "scene" | "fps";

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

export function listFrameJpegFiles(files: string[]): string[] {
  return files
    .filter((file) => file.startsWith("frame_") && file.endsWith(".jpg"))
    .sort();
}

async function listExtractedFrameFiles(tmpDir: string): Promise<string[]> {
  return listFrameJpegFiles(await fs.readdir(tmpDir));
}

type FfmpegRunResult = {
  stderr: string;
};

async function runFfmpegExtract(
  ffmpeg: string,
  videoPath: string,
  pattern: string,
  vf: string,
): Promise<FfmpegRunResult> {
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        videoPath,
        "-an",
        "-vf",
        vf,
        "-vsync",
        "vfr",
        pattern,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return { stderr: stderr?.trim() ?? "" };
  } catch (error) {
    const execError = error as { stderr?: string; message?: string };
    const detail = execError.stderr?.trim() || execError.message || "ffmpeg failed";
    throw new Error(detail);
  }
}

async function probeVideo(ffmpeg: string, videoPath: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      ["-hide_banner", "-i", videoPath, "-f", "null", "-"],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return stderr?.trim() ?? "";
  } catch (error) {
    const execError = error as { stderr?: string; message?: string };
    return execError.stderr?.trim() || execError.message || "";
  }
}

/**
 * Extract frames from video using ffmpeg scene detection.
 * Falls back to fixed fps sampling when scene detection yields no frames or errors.
 * Also probes video duration and computes frame-skip stats relative to a baseline fps.
 * Accepts an optional ExtractionConfig to parameterize the scene threshold and sample fps.
 */
export async function extractLeaderboardFrames(
  videoPath: string,
  extractionConfig?: ExtractionConfig,
): Promise<ExtractLeaderboardFramesResult> {
  const config = extractionConfig ?? { mode: "scene", sceneThreshold: 0.25, sampleFps: 1 };
  const sceneThreshold =
    Number.isFinite(config.sceneThreshold) && (config.sceneThreshold as number) > 0
      ? (config.sceneThreshold as number)
      : 0.25;
  const sampleFps =
    Number.isFinite(config.sampleFps) && (config.sampleFps as number) > 0
      ? (config.sampleFps as number)
      : 1;

  if (!(await ffmpegAvailable())) {
    throw new Error(
      "ffmpeg is not installed. Install ffmpeg to process videos locally.",
    );
  }

  const videoDurationSeconds = await probeVideoDurationSeconds(videoPath);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hq-frames-"));
  const pattern = path.join(tmpDir, "frame_%04d.jpg");
  const ffmpeg = resolveFfmpegBinary();

  let mode: FrameExtractMode = config.mode === "fps" ? "fps" : "scene";
  let lastStderr = "";

  // If config requests fps-only mode, skip scene detection entirely
  if (config.mode === "fps") {
    const fpsStarted = Date.now();
    try {
      const result = await runFfmpegExtract(
        ffmpeg,
        videoPath,
        pattern,
        `fps=${sampleFps},scale=720:-1`,
      );
      lastStderr = result.stderr;
      logPipelineStep("ffmpeg.fps_extract", Date.now() - fpsStarted, {
        fps: sampleFps,
        frameCount: (await listExtractedFrameFiles(tmpDir)).length,
      });
    } catch (fpsError) {
      const fpsMessage = fpsError instanceof Error ? fpsError.message : String(fpsError);
      const probe = await probeVideo(ffmpeg, videoPath);
      throw new Error(
        [
          "No frames extracted from video.",
          `Fps extraction failed: ${fpsMessage.slice(0, 300)}`,
          probe ? `Video probe: ${probe.slice(0, 400)}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
  } else {
    const sceneStarted = Date.now();
    try {
      const result = await runFfmpegExtract(
        ffmpeg,
        videoPath,
        pattern,
        `select='gt(scene,${sceneThreshold})',scale=720:-1`,
      );
      lastStderr = result.stderr;
      const sceneFrameCount = (await listExtractedFrameFiles(tmpDir)).length;
      logPipelineStep("ffmpeg.scene_detect", Date.now() - sceneStarted, {
        mode: "scene",
        sceneThreshold,
        frameCount: sceneFrameCount,
      });

      if (sceneFrameCount === 0) {
        mode = "fps";
        const fallbackStarted = Date.now();
        const fallback = await runFfmpegExtract(
          ffmpeg,
          videoPath,
          pattern,
          `fps=${sampleFps},scale=720:-1`,
        );
        lastStderr = fallback.stderr;
        logPipelineStep("ffmpeg.fps_fallback", Date.now() - fallbackStarted, {
          fps: sampleFps,
          reason: "scene_detect_empty",
          frameCount: (await listExtractedFrameFiles(tmpDir)).length,
        });
      }
    } catch (sceneError) {
      mode = "fps";
      lastStderr =
        sceneError instanceof Error ? sceneError.message : String(sceneError);
      logPipelineStep("ffmpeg.scene_detect", Date.now() - sceneStarted, {
        mode: "scene",
        frameCount: 0,
        error: lastStderr.slice(0, 200),
      });

      const fallbackStarted = Date.now();
      try {
        const fallback = await runFfmpegExtract(
          ffmpeg,
          videoPath,
          pattern,
          `fps=${sampleFps},scale=720:-1`,
        );
        lastStderr = fallback.stderr;
        logPipelineStep("ffmpeg.fps_fallback", Date.now() - fallbackStarted, {
          fps: sampleFps,
          reason: "scene_detect_error",
          frameCount: (await listExtractedFrameFiles(tmpDir)).length,
        });
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        const probe = await probeVideo(ffmpeg, videoPath);
        throw new Error(
          [
            "No frames extracted from video.",
            `Scene detection failed: ${lastStderr.slice(0, 300)}`,
            `Fps fallback failed: ${fallbackMessage.slice(0, 300)}`,
            probe ? `Video probe: ${probe.slice(0, 400)}` : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
    }
  }

  const files = await listExtractedFrameFiles(tmpDir);
  if (files.length === 0) {
    const probe = await probeVideo(ffmpeg, videoPath);
    throw new Error(
      [
        "No frames extracted from video.",
        `Tried scene detection and ${sampleFps} fps sampling (${mode} last).`,
        lastStderr ? `Last ffmpeg stderr: ${lastStderr.slice(0, 300)}` : null,
        probe ? `Video probe: ${probe.slice(0, 400)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
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
    mode,
  });

  const denseFrameCount =
    videoDurationSeconds != null
      ? estimateDenseFrameCount(videoDurationSeconds)
      : null;
  const framesSkipped = computeFramesSkipped(denseFrameCount, frames.length);

  return { frames, videoDurationSeconds, denseFrameCount, framesSkipped };
}

export async function cleanupFrameTempDir(frames: ExtractedFrame[]) {
  if (frames.length === 0) return;
  const dir = path.dirname(frames[0]!.filePath);
  await fs.rm(dir, { recursive: true, force: true });
}
