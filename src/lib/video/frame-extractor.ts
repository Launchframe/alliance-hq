import { execFile } from "node:child_process";
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

/** Skip encoder/recording startup artifacts; capture opening/closing bookend frames near the ends. */
export const FORCED_FIRST_FRAME_OFFSET_SECONDS = 0.05;

/** Capture the tail of the scroll so the last on-screen rows are not missed. */
export const FORCED_LAST_FRAME_OFFSET_SECONDS = 0.05;

/** Treat bookend frames within this window as duplicates of scene captures. */
export const BOOKEND_FRAME_DEDUPE_SECONDS = 0.05;

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

/** Parse ffprobe-style frame rate strings (e.g. `30000/1001`, `30/1`). */
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

/** Input frame index for the forced opening capture (~50ms; one frame only). */
export function forcedFirstFrameIndexForFps(fps: number | null): number {
  if (fps != null && fps > 0) {
    return Math.max(1, Math.round(FORCED_FIRST_FRAME_OFFSET_SECONDS * fps));
  }
  // ~50ms at 30fps when frame rate cannot be read from the container.
  return 2;
}

/** Parse `Duration: HH:MM:SS.xx` from ffmpeg `-i` stderr. */
export function parseFfmpegDurationSeconds(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const total =
    Number(match[1]) * 3600 +
    Number(match[2]) * 60 +
    Number.parseFloat(match[3]!);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/** Parse nominal fps from ffmpeg `-i` stderr (e.g. `..., 29.97 fps,`). */
export function parseFfmpegFrameRateFromStderr(stderr: string): number | null {
  const match = stderr.match(/,\s*(\d+(?:\.\d+)?)\s*fps\b/i);
  if (!match) {
    return null;
  }
  const fps = Number.parseFloat(match[1]!);
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

async function probeVideoWithFfmpeg(videoPath: string): Promise<VideoProbeInfo> {
  if (!(await ffmpegAvailable())) {
    return { durationSeconds: null, frameRateFps: null };
  }
  const ffmpeg = resolveFfmpegBinary();
  const stderr = await probeVideo(ffmpeg, videoPath);
  return {
    durationSeconds: parseFfmpegDurationSeconds(stderr),
    frameRateFps: parseFfmpegFrameRateFromStderr(stderr),
  };
}

/** Probe duration via ffmpeg `-i` (no ffprobe binary required). */
export async function probeVideoDurationSeconds(
  videoPath: string,
): Promise<number | null> {
  const probe = await probeVideoWithFfmpeg(videoPath);
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
 * frame (n=0) has no score and is never selected by `gt(scene,…)` alone.
 * Opening/closing bookends (~50ms from each end) are extracted separately via
 * accurate time seeks so fps mis-probes cannot push the first capture to ~1s.
 *
 * No `scale=` filter here on purpose: these frames are what OCR reads, so they
 * must stay at source resolution. Downsampling happens later, only for the
 * long-term playback archive (see `archive-source.ts`).
 */
export function buildSceneSelectFilter(
  sceneThreshold: number,
  supplementFrameInterval?: number | null,
): string {
  const triggers = [`gt(scene,${sceneThreshold})`];
  if (supplementFrameInterval != null && supplementFrameInterval > 0) {
    triggers.push(`eq(mod(n\\,${supplementFrameInterval}),0)`);
  }
  return `select='${triggers.join("+")}'`;
}

/** Frame interval for periodic sampling at a target fps given source fps. */
export function supplementFrameIntervalForFps(
  videoFps: number | null,
  supplementFps: number,
): number | null {
  if (videoFps == null || videoFps <= 0 || supplementFps <= 0) return null;
  return Math.max(1, Math.floor(videoFps / supplementFps));
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

/** Merge scene captures with time-seeked opening/closing bookends; dedupe near duplicates. */
export function mergeSceneFramesWithBookends(
  sceneFrames: ExtractedFrame[],
  bookends: readonly ExtractedFrame[],
): ExtractedFrame[] {
  const combined = [...sceneFrames, ...bookends];
  combined.sort((a, b) => {
    const ta = a.videoTimestampSeconds;
    const tb = b.videoTimestampSeconds;
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    if (ta == null && tb != null) return 1;
    if (ta != null && tb == null) return -1;
    return a.index - b.index;
  });

  const kept: ExtractedFrame[] = [];
  for (const frame of combined) {
    const t = frame.videoTimestampSeconds;
    if (
      t != null &&
      kept.some(
        (existing) =>
          existing.videoTimestampSeconds != null &&
          Math.abs(existing.videoTimestampSeconds - t) <
            BOOKEND_FRAME_DEDUPE_SECONDS,
      )
    ) {
      continue;
    }
    kept.push(frame);
  }

  return kept.map((frame, index) => ({ ...frame, index }));
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

async function extractBookendFrame(
  ffmpeg: string,
  videoPath: string,
  outputPath: string,
  position: "opening" | "closing",
): Promise<FfmpegRunResult> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "info",
    "-nostdin",
    "-y",
  ];
  if (position === "closing") {
    args.push("-sseof", `-${FORCED_LAST_FRAME_OFFSET_SECONDS}`);
  }
  args.push("-i", videoPath);
  if (position === "opening") {
    args.push("-ss", String(FORCED_FIRST_FRAME_OFFSET_SECONDS));
  }
  args.push("-an", "-frames:v", "1", "-vf", "showinfo", outputPath);

  try {
    const { stderr } = await execFileAsync(ffmpeg, args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stderr: stderr?.trim() ?? "" };
  } catch (error) {
    const execError = error as { stderr?: string; message?: string };
    const detail = execError.stderr?.trim() || execError.message || "ffmpeg failed";
    throw new Error(detail);
  }
}

async function extractSceneBookendFrames(
  ffmpeg: string,
  videoPath: string,
  tmpDir: string,
  videoDurationSeconds: number | null,
  sampleFps: number,
): Promise<ExtractedFrame[]> {
  const bookends: ExtractedFrame[] = [];
  const openingPath = path.join(tmpDir, "bookend_opening.jpg");
  const closingPath = path.join(tmpDir, "bookend_closing.jpg");

  try {
    const openingResult = await extractBookendFrame(
      ffmpeg,
      videoPath,
      openingPath,
      "opening",
    );
    const openingBuffer = await fs.readFile(openingPath);
    const [openingFrame] = assignVideoTimestampsToFrames(
      [{ index: 0, filePath: openingPath, buffer: openingBuffer }],
      openingResult.stderr,
      "scene",
      sampleFps,
    );
    if (openingFrame) {
      bookends.push(openingFrame);
    }
  } catch {
    // Opening bookend is best-effort; scene+fallback paths still run.
  }

  const minDurationForClosing =
    FORCED_FIRST_FRAME_OFFSET_SECONDS +
    FORCED_LAST_FRAME_OFFSET_SECONDS +
    0.05;
  if (
    videoDurationSeconds == null ||
    videoDurationSeconds >= minDurationForClosing
  ) {
    try {
      const closingResult = await extractBookendFrame(
        ffmpeg,
        videoPath,
        closingPath,
        "closing",
      );
      const closingBuffer = await fs.readFile(closingPath);
      const [closingFrame] = assignVideoTimestampsToFrames(
        [{ index: 0, filePath: closingPath, buffer: closingBuffer }],
        closingResult.stderr,
        "scene",
        sampleFps,
      );
      if (closingFrame) {
        bookends.push(closingFrame);
      }
    } catch {
      // Closing bookend is best-effort.
    }
  }

  return bookends;
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
  const supplementFps =
    Number.isFinite(config.supplementFps) && (config.supplementFps as number) > 0
      ? (config.supplementFps as number)
      : null;

  if (!(await ffmpegAvailable())) {
    throw new Error(
      "ffmpeg is not installed. Install ffmpeg to process videos locally.",
    );
  }

  const videoProbe = await probeVideoWithFfmpeg(videoPath);
  const videoDurationSeconds = videoProbe.durationSeconds;
  const supplementFrameInterval =
    supplementFps != null
      ? supplementFrameIntervalForFps(videoProbe.frameRateFps, supplementFps)
      : null;

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
        `fps=${sampleFps}`,
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
        buildSceneSelectFilter(sceneThreshold, supplementFrameInterval),
      );
      lastStderr = result.stderr;
      const sceneFrameCount = (await listExtractedFrameFiles(tmpDir)).length;
      logPipelineStep("ffmpeg.scene_detect", Date.now() - sceneStarted, {
        mode: "scene",
        sceneThreshold,
        frameRateFps: videoProbe.frameRateFps,
        frameCount: sceneFrameCount,
      });
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
          `fps=${sampleFps}`,
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
  if (files.length === 0 && mode !== "scene") {
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
  let frames = assignVideoTimestampsToFrames(
    rawFrames,
    lastStderr,
    mode,
    sampleFps,
  );

  if (mode === "scene") {
    const bookendStarted = Date.now();
    const bookends = await extractSceneBookendFrames(
      ffmpeg,
      videoPath,
      tmpDir,
      videoDurationSeconds,
      sampleFps,
    );
    frames = mergeSceneFramesWithBookends(frames, bookends);
    logPipelineStep("ffmpeg.scene_bookends", Date.now() - bookendStarted, {
      bookendCount: bookends.length,
      mergedFrameCount: frames.length,
    });

    // Fall back to fps when scene motion + bookends still yield almost nothing.
    if (frames.length <= 1) {
      mode = "fps";
      const fallbackStarted = Date.now();
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      const fallback = await runFfmpegExtract(
        ffmpeg,
        videoPath,
        pattern,
        `fps=${sampleFps}`,
      );
      lastStderr = fallback.stderr;
      const fallbackFiles = await listExtractedFrameFiles(tmpDir);
      const fallbackRaw: Omit<ExtractedFrame, "videoTimestampSeconds">[] = [];
      for (let i = 0; i < fallbackFiles.length; i++) {
        const filePath = path.join(tmpDir, fallbackFiles[i]!);
        const buffer = await fs.readFile(filePath);
        fallbackRaw.push({ index: i, filePath, buffer });
      }
      frames = assignVideoTimestampsToFrames(
        fallbackRaw,
        lastStderr,
        mode,
        sampleFps,
      );
      logPipelineStep("ffmpeg.fps_fallback", Date.now() - fallbackStarted, {
        fps: sampleFps,
        reason: "scene_detect_sparse",
        frameCount: frames.length,
      });
    }
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
