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

/** Skip encoder/recording startup artifacts; still one forced frame (no extra OCR). */
export const FORCED_FIRST_FRAME_OFFSET_SECONDS = 0.1;

export type ExtractedFrame = {
  index: number;
  filePath: string;
  buffer: Buffer;
  /** Seconds into the source video when this frame was captured, if known. */
  videoTimestampSeconds: number | null;
};

export type ExtractLeaderboardFramesResult = {
  frames: ExtractedFrame[];
  videoDurationSeconds: number | null;
  denseFrameCount: number | null;
  framesSkipped: number | null;
};

type VideoProbeInfo = {
  durationSeconds: number | null;
  frameRateFps: number | null;
};

/** Parse ffprobe `avg_frame_rate` / `r_frame_rate` (e.g. `30000/1001`, `30/1`). */
export function parseFfprobeFrameRate(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }
  if (value.includes("/")) {
    const [numRaw, denRaw] = value.split("/");
    const num = Number(numRaw);
    const den = Number(denRaw);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0) {
      return num / den;
    }
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Input frame index for the forced opening capture (~100ms; one frame only). */
export function forcedFirstFrameIndexForFps(fps: number | null): number {
  if (fps != null && fps > 0) {
    return Math.max(1, Math.round(FORCED_FIRST_FRAME_OFFSET_SECONDS * fps));
  }
  // ~100ms at 30fps when ffprobe cannot read frame rate.
  return 3;
}

async function probeVideoWithFfprobe(videoPath: string): Promise<VideoProbeInfo> {
  let ffprobePath: string;
  try {
    const ffprobeStatic = await import("ffprobe-static");
    ffprobePath =
      (ffprobeStatic as unknown as { path: string }).path ??
      (ffprobeStatic.default as unknown as { path: string })?.path;
    if (!ffprobePath) {
      return { durationSeconds: null, frameRateFps: null };
    }
  } catch {
    return { durationSeconds: null, frameRateFps: null };
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
        resolve({ durationSeconds: null, frameRateFps: null });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          format?: { duration?: string };
          streams?: Array<{
            duration?: string;
            codec_type?: string;
            avg_frame_rate?: string;
            r_frame_rate?: string;
          }>;
        };
        let durationSeconds: number | null = null;
        const fromFormat = parsed.format?.duration
          ? parseFloat(parsed.format.duration)
          : null;
        if (Number.isFinite(fromFormat) && fromFormat! > 0) {
          durationSeconds = fromFormat;
        }

        const videoStream = parsed.streams?.find(
          (s) => s.codec_type === "video",
        );
        if (durationSeconds == null && videoStream?.duration) {
          const fromStream = parseFloat(videoStream.duration);
          if (Number.isFinite(fromStream) && fromStream > 0) {
            durationSeconds = fromStream;
          }
        }

        const frameRateFps =
          parseFfprobeFrameRate(videoStream?.avg_frame_rate) ??
          parseFfprobeFrameRate(videoStream?.r_frame_rate);

        resolve({ durationSeconds, frameRateFps });
      } catch {
        resolve({ durationSeconds: null, frameRateFps: null });
      }
    });
    proc.on("error", () => resolve({ durationSeconds: null, frameRateFps: null }));
  });
}

/**
 * Probe a video file with ffprobe to get its duration in seconds.
 * Returns null if ffprobe-static is not available or the probe fails.
 */
export async function probeVideoDurationSeconds(
  videoPath: string,
): Promise<number | null> {
  const probe = await probeVideoWithFfprobe(videoPath);
  return probe.durationSeconds;
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

export function appendShowinfoFilter(vf: string): string {
  return vf.includes("showinfo") ? vf : `${vf},showinfo`;
}

/**
 * Build the ffmpeg scene-detection select filter.
 *
 * ffmpeg's `scene` metric compares each frame to its predecessor, so the first
 * frame (n=0) has no score and is never selected by `gt(scene,…)` alone. We OR
 * in one forced opening frame (~100ms in) so leaderboard rows visible before
 * the user scrolls are captured without t=0 encoder/recording junk.
 */
export function buildSceneSelectFilter(
  sceneThreshold: number,
  forcedFirstFrameIndex: number,
): string {
  return `select='eq(n,${forcedFirstFrameIndex})+gt(scene,${sceneThreshold})',scale=720:-1`;
}

/** Parse pts_time values emitted by ffmpeg's showinfo filter (one per output frame). */
export function parseFfmpegShowinfoPtsTimes(stderr: string): number[] {
  const times: number[] = [];
  const re = /pts_time:([0-9.+-eE]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stderr)) !== null) {
    const value = Number.parseFloat(match[1]!);
    if (Number.isFinite(value)) {
      times.push(value);
    }
  }
  return times;
}

export function assignVideoTimestampsToFrames(
  frames: Omit<ExtractedFrame, "videoTimestampSeconds">[],
  stderr: string,
  mode: FrameExtractMode,
  sampleFps: number,
): ExtractedFrame[] {
  const ptsTimes = parseFfmpegShowinfoPtsTimes(stderr);
  return frames.map((frame, i) => {
    let videoTimestampSeconds: number | null = null;
    if (ptsTimes[i] != null && Number.isFinite(ptsTimes[i])) {
      videoTimestampSeconds = ptsTimes[i]!;
    } else if (mode === "fps" && sampleFps > 0) {
      videoTimestampSeconds = frame.index / sampleFps;
    }
    return { ...frame, videoTimestampSeconds };
  });
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
  const vfWithShowinfo = appendShowinfoFilter(vf);
  try {
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "info",
        "-nostdin",
        "-y",
        "-i",
        videoPath,
        "-an",
        "-vf",
        vfWithShowinfo,
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

  const videoProbe = await probeVideoWithFfprobe(videoPath);
  const videoDurationSeconds = videoProbe.durationSeconds;
  const forcedFirstFrameIndex = forcedFirstFrameIndexForFps(
    videoProbe.frameRateFps,
  );

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
        buildSceneSelectFilter(sceneThreshold, forcedFirstFrameIndex),
      );
      lastStderr = result.stderr;
      const sceneFrameCount = (await listExtractedFrameFiles(tmpDir)).length;
      logPipelineStep("ffmpeg.scene_detect", Date.now() - sceneStarted, {
        mode: "scene",
        sceneThreshold,
        frameRateFps: videoProbe.frameRateFps,
        forcedFirstFrameIndex,
        frameCount: sceneFrameCount,
      });

      // Scene mode always forces one opening frame (~100ms), so "<= 1" no longer
      // signals real motion. Fall back to fps when that forced frame is the only
      // capture, to avoid missing slow/sub-threshold scrolling.
      if (sceneFrameCount <= 1) {
        mode = "fps";
        const fallbackStarted = Date.now();
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.mkdir(tmpDir, { recursive: true });
        const fallback = await runFfmpegExtract(
          ffmpeg,
          videoPath,
          pattern,
          `fps=${sampleFps},scale=720:-1`,
        );
        lastStderr = fallback.stderr;
        logPipelineStep("ffmpeg.fps_fallback", Date.now() - fallbackStarted, {
          fps: sampleFps,
          reason: "scene_detect_sparse",
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
  const rawFrames: Omit<ExtractedFrame, "videoTimestampSeconds">[] = [];
  for (let i = 0; i < files.length; i++) {
    const filePath = path.join(tmpDir, files[i]!);
    const buffer = await fs.readFile(filePath);
    rawFrames.push({ index: i, filePath, buffer });
  }
  const frames = assignVideoTimestampsToFrames(
    rawFrames,
    lastStderr,
    mode,
    sampleFps,
  );
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
