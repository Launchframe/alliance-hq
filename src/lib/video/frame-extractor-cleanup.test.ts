import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  mkdtemp: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  mkdir: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", () => ({
  default: {
    mkdtemp: mocks.mkdtemp,
    readdir: mocks.readdir,
    readFile: mocks.readFile,
    rm: mocks.rm,
    mkdir: mocks.mkdir,
  },
}));
vi.mock("ffmpeg-static", () => ({ default: "/fake/ffmpeg" }));
vi.mock("@/lib/video/pipeline-step-log", () => ({ logPipelineStep: vi.fn() }));

import { extractLeaderboardFrames } from "./frame-extractor";

const TMP_DIR = "/tmp/hq-frames-test123";
const execArgv: string[][] = [];

function vfArgs() {
  return execArgv
    .map((argv) => argv[argv.indexOf("-vf") + 1])
    .filter((value): value is string => typeof value === "string");
}

beforeEach(() => {
  vi.clearAllMocks();
  execArgv.length = 0;
  mocks.mkdtemp.mockResolvedValue(TMP_DIR);
  mocks.readdir.mockResolvedValue([]);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.rm.mockResolvedValue(undefined);
  mocks.execFile.mockImplementation((...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      error: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void;
    const argv = args[1] as string[];
    execArgv.push(argv);
    if (argv[0] === "-version") {
      callback(null, { stdout: "ffmpeg version 6", stderr: "" });
      return;
    }
    callback(Object.assign(new Error("ffmpeg failed"), { stderr: "ffmpeg exploded" }));
  });
});

describe("extractLeaderboardFrames temp cleanup", () => {
  it("removes the hq-frames temp dir when extraction fails after mkdtemp", async () => {
    await expect(
      extractLeaderboardFrames("/tmp/video.mp4", { mode: "fps", sampleFps: 1 }),
    ).rejects.toThrow("No frames extracted");
    expect(mocks.rm).toHaveBeenCalledWith(TMP_DIR, { recursive: true, force: true });
  });

  it("appends fps=N to the scene select filter only when maxOutputFps is supplied", async () => {
    await expect(
      extractLeaderboardFrames("/tmp/video.mp4", { mode: "scene", sceneThreshold: 0.25 }, { maxOutputFps: 2 }),
    ).rejects.toThrow();
    expect(vfArgs().some((vf) => vf.includes("select='gt(scene,0.25)',fps=2"))).toBe(true);

    execArgv.length = 0;
    await expect(
      extractLeaderboardFrames("/tmp/video.mp4", { mode: "scene", sceneThreshold: 0.25 }),
    ).rejects.toThrow();
    expect(vfArgs().every((vf) => !vf.includes(",fps="))).toBe(true);
  });

  it("rejects a non-positive maxOutputFps", async () => {
    await expect(
      extractLeaderboardFrames("/tmp/video.mp4", { mode: "fps" }, { maxOutputFps: 0 }),
    ).rejects.toThrow("maxOutputFps");
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
  });
});
