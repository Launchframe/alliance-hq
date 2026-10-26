import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

import { openingMenuProbeTimestamps } from "@/lib/video/opening-menu-probe.shared";
import { logPipelineStep } from "@/lib/video/pipeline-step-log";
import type { ExtractionConfig } from "@/lib/video/pass-definitions";
import {
  computeFramesSkipped,
  estimateDenseFrameCount,
} from "@/lib/video/pipeline-stats-display";

const execFileAsync = promisify(execFile);

/**
 * Opening bookend is the first decoded frame (t=0). A 50ms seek already skips
 * the top of a fast leaderboard scroll. Scene detection still skips n=0, so
 * this bookend is what puts that frame in the set.
 */
export const FORCED_FIRST_FRAME_OFFSET_SECONDS = 0;

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

/** Input frame index for the forced opening capture: the first decoded frame. */
export function forcedFirstFrameIndexForFps(_fps: number | null): number {
  return 0;
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

export function listFrameJpegFiles(files: string[], imageFormat: "jpg" | "png" = "jpg"): string[] {
  return files
    .filter((file) => file.startsWith("frame_") && file.endsWith(`.${imageFormat}`))
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
 * The opening bookend is the first decoded frame (or the first later probe
 * that shows the leaderboard menu). The closing bookend is a short seek
 * before the end. Both are extracted separately so fps mis-probes cannot
 * push the first capture to ~1s.
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

/**
 * Fps used when scene detection fails or yields almost nothing: sample
 * denser than the configured baseline (~4 fps for short clips) so
 * fast-scrolled rows are not skipped, bounded to `cap` total frames.
 */
export function fallbackSampleFpsForDuration(
  sampleFps: number,
  videoDurationSeconds: number | null,
  cap = 60,
): number {
  const target = 4;
  if (videoDurationSeconds == null || videoDurationSeconds <= 0) {
    return Math.max(sampleFps, target);
  }
  return Math.max(sampleFps, Math.min(target, cap / videoDurationSeconds));
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
function compareFramesByTimestamp(a: ExtractedFrame, b: ExtractedFrame): number {
  const ta = a.videoTimestampSeconds;
  const tb = b.videoTimestampSeconds;
  if (ta != null && tb != null && ta !== tb) return ta - tb;
  if (ta == null && tb != null) return 1;
  if (ta != null && tb == null) return -1;
  return a.index - b.index;
}

function bookendDuplicatesEarlierFrame(
  timestamp: number,
  frames: readonly ExtractedFrame[],
): boolean {
  return frames.some((existing) => {
    if (existing.videoTimestampSeconds == null) return false;
    // A later scene frame is a different moment on a fast scroll.
    if (existing.videoTimestampSeconds > timestamp + 0.001) return false;
    return (
      Math.abs(existing.videoTimestampSeconds - timestamp) <
      BOOKEND_FRAME_DEDUPE_SECONDS
    );
  });
}

export function mergeSceneFramesWithBookends(
  sceneFrames: ExtractedFrame[],
  bookends: readonly ExtractedFrame[],
): ExtractedFrame[] {
  const kept = [...sceneFrames].sort(compareFramesByTimestamp);

  for (const bookend of [...bookends].sort(compareFramesByTimestamp)) {
    const t = bookend.videoTimestampSeconds;
    if (t != null && bookendDuplicatesEarlierFrame(t, kept)) {
      continue;
    }
    kept.push(bookend);
  }

  kept.sort(compareFramesByTimestamp);
  return kept.map((frame, index) => ({ ...frame, index }));
}

async function listExtractedFrameFiles(
  tmpDir: string,
  imageFormat: "jpg" | "png" = "jpg",
): Promise<string[]> {
  return listFrameJpegFiles(await fs.readdir(tmpDir), imageFormat);
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

async function extractFrameAt(
  ffmpeg: string,
  videoPath: string,
  outputPath: string,
  timestampSeconds: number,
): Promise<FfmpegRunResult> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "info",
    "-nostdin",
    "-y",
    "-i",
    videoPath,
  ];
  if (timestampSeconds > 0) {
    args.push("-ss", String(timestampSeconds));
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

async function extractBookendFrame(
  ffmpeg: string,
  videoPath: string,
  outputPath: string,
): Promise<FfmpegRunResult> {
  const args = [
    "-hide_banner",
    "-loglevel",
    "info",
    "-nostdin",
    "-y",
    "-sseof",
    `-${FORCED_LAST_FRAME_OFFSET_SECONDS}`,
    "-i",
    videoPath,
    "-an",
    "-frames:v",
    "1",
    "-vf",
    "showinfo",
    outputPath,
  ];

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

async function readSeekedFrame(
  ffmpeg: string,
  videoPath: string,
  outputPath: string,
  timestampSeconds: number,
  sampleFps: number,
): Promise<ExtractedFrame | null> {
  const result = await extractFrameAt(
    ffmpeg,
    videoPath,
    outputPath,
    timestampSeconds,
  );
  const buffer = await fs.readFile(outputPath);
  const [frame] = assignVideoTimestampsToFrames(
    [{ index: 0, filePath: outputPath, buffer }],
    result.stderr,
    "scene",
    sampleFps,
  );
  if (!frame) return null;
  return {
    ...frame,
    videoTimestampSeconds: frame.videoTimestampSeconds ?? timestampSeconds,
  };
}

async function extractSceneBookendFrames(
  ffmpeg: string,
  videoPath: string,
  tmpDir: string,
  videoDurationSeconds: number | null,
  sampleFps: number,
  imageFormat: "jpg" | "png" = "jpg",
  frameRateFps: number | null = null,
  openingFrameShowsMenu?: (buffer: Buffer) => Promise<boolean>,
): Promise<ExtractedFrame[]> {
  const bookends: ExtractedFrame[] = [];
  const closingPath = path.join(tmpDir, `bookend_closing.${imageFormat}`);
  const probeTimestamps = openingFrameShowsMenu
    ? openingMenuProbeTimestamps(frameRateFps)
    : [FORCED_FIRST_FRAME_OFFSET_SECONDS];

  let openingFallback: ExtractedFrame | null = null;
  for (let probeIndex = 0; probeIndex < probeTimestamps.length; probeIndex += 1) {
    const timestamp = probeTimestamps[probeIndex]!;
    const openingPath = path.join(
      tmpDir,
      `bookend_opening_${probeIndex}.${imageFormat}`,
    );
    try {
      const frame = await readSeekedFrame(
        ffmpeg,
        videoPath,
        openingPath,
        timestamp,
        sampleFps,
      );
      if (!frame) continue;
      if (!openingFrameShowsMenu) {
        bookends.push(frame);
        openingFallback = null;
        break;
      }
      if (!openingFallback) openingFallback = frame;
      const showsMenu = await openingFrameShowsMenu(frame.buffer).catch(
        () => false,
      );
      if (showsMenu) {
        bookends.push(frame);
        openingFallback = null;
        logPipelineStep("ffmpeg.opening_menu_probe", 0, {
          timestampSeconds: frame.videoTimestampSeconds,
          probeIndex,
          matched: true,
        });
        break;
      }
    } catch {
      // This probe is best-effort; try the next backoff step.
    }
  }
  if (openingFallback) {
    bookends.push(openingFallback);
    logPipelineStep("ffmpeg.opening_menu_probe", 0, {
      timestampSeconds: openingFallback.videoTimestampSeconds,
      matched: false,
    });
  }

  const minDurationForClosing =
    FORCED_LAST_FRAME_OFFSET_SECONDS + 0.05;
  if (
    videoDurationSeconds == null ||
    videoDurationSeconds >= minDurationForClosing
  ) {
    try {
      const closingResult = await extractBookendFrame(
        ffmpeg,
        videoPath,
        closingPath,
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
  options?: {
    imageFormat?: "jpg" | "png";
    maxOutputFps?: number;
    /**
     * When set, VS uploads probe the start of the video until this returns
     * true. The first decoded frame is kept when no probe matches.
     */
    openingFrameShowsMenu?: (buffer: Buffer) => Promise<boolean>;
  },
): Promise<ExtractLeaderboardFramesResult> {
  const imageFormat = options?.imageFormat === "png" ? "png" : "jpg";
  const maxOutputFps = options?.maxOutputFps;
  if (maxOutputFps != null && (!Number.isFinite(maxOutputFps) || maxOutputFps <= 0)) {
    throw new Error("maxOutputFps must be a positive finite number");
  }
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
  const pattern = path.join(tmpDir, `frame_%04d.${imageFormat}`);
  const ffmpeg = resolveFfmpegBinary();

  try {
  let mode: FrameExtractMode = config.mode === "fps" ? "fps" : "scene";
  let lastStderr = "";
  let effectiveSampleFps = sampleFps;

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
        frameCount: (await listExtractedFrameFiles(tmpDir, imageFormat)).length,
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
        buildSceneSelectFilter(sceneThreshold, supplementFrameInterval) +
          (maxOutputFps != null ? `,fps=${maxOutputFps}` : ""),
      );
      lastStderr = result.stderr;
      const sceneFrameCount = (await listExtractedFrameFiles(tmpDir, imageFormat)).length;
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
      const denseFallbackFps = fallbackSampleFpsForDuration(
        sampleFps,
        videoDurationSeconds,
      );
      effectiveSampleFps = denseFallbackFps;
      try {
        const fallback = await runFfmpegExtract(
          ffmpeg,
          videoPath,
          pattern,
          `fps=${denseFallbackFps}`,
        );
        lastStderr = fallback.stderr;
        logPipelineStep("ffmpeg.fps_fallback", Date.now() - fallbackStarted, {
          fps: denseFallbackFps,
          reason: "scene_detect_error",
          frameCount: (await listExtractedFrameFiles(tmpDir, imageFormat)).length,
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

  const files = await listExtractedFrameFiles(tmpDir, imageFormat);
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
    effectiveSampleFps,
  );

  if (mode === "scene") {
    const bookendStarted = Date.now();
    const bookends = await extractSceneBookendFrames(
      ffmpeg,
      videoPath,
      tmpDir,
      videoDurationSeconds,
      sampleFps,
      imageFormat,
      videoProbe.frameRateFps,
      options?.openingFrameShowsMenu,
    );
    frames = mergeSceneFramesWithBookends(frames, bookends);
    logPipelineStep("ffmpeg.scene_bookends", Date.now() - bookendStarted, {
      bookendCount: bookends.length,
      mergedFrameCount: frames.length,
    });

    // Fall back to fps when scene motion + bookends still yield almost
    // nothing — or, for short clips, fewer than ~2 frames per second,
    // which misses members on a fast scroll.
    if (
      frames.length <= 1 ||
      (videoDurationSeconds != null &&
        videoDurationSeconds <= 30 &&
        frames.length < videoDurationSeconds * 2)
    ) {
      mode = "fps";
      const fallbackStarted = Date.now();
      const denseFallbackFps = fallbackSampleFpsForDuration(
        sampleFps,
        videoDurationSeconds,
      );
      effectiveSampleFps = denseFallbackFps;
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });
      const fallback = await runFfmpegExtract(
        ffmpeg,
        videoPath,
        pattern,
        `fps=${denseFallbackFps}`,
      );
      lastStderr = fallback.stderr;
      const fallbackFiles = await listExtractedFrameFiles(tmpDir, imageFormat);
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
        effectiveSampleFps,
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
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function cleanupFrameTempDir(frames: ExtractedFrame[]) {
  // Image-ingest frames carry no temp files (empty filePath) — nothing to
  // clean. Never resolve dirname("") → "." and remove the working tree.
  if (frames.length === 0 || !frames[0]!.filePath) return;
  const dir = path.dirname(frames[0]!.filePath);
  await fs.rm(dir, { recursive: true, force: true });
}
