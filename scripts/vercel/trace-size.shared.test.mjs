import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildEffectiveTraceSet,
  expandTracingPattern,
  summarizeTraceFiles,
} from "./trace-size.shared.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-size-"));
  tempDirs.push(dir);
  return dir;
}

describe("expandTracingPattern", () => {
  it("expands exact files and /** directories", () => {
    const root = tempRoot();
    fs.mkdirSync(path.join(root, "node_modules/pkg/nested"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules/pkg/nested/a.txt"), "aa");
    fs.writeFileSync(path.join(root, "node_modules/pkg/b.txt"), "b");

    expect(
      expandTracingPattern(root, "./node_modules/pkg/nested/**/*").map((p) =>
        path.basename(p),
      ),
    ).toEqual(["a.txt"]);

    expect(
      expandTracingPattern(root, "./node_modules/pkg/b.txt").map((p) =>
        path.basename(p),
      ),
    ).toEqual(["b.txt"]);
  });
});

describe("buildEffectiveTraceSet", () => {
  it("merges nft files with includes and applies excludes", () => {
    const root = tempRoot();
    const nftDir = path.join(root, ".next/server/app/api/demo");
    fs.mkdirSync(nftDir, { recursive: true });

    const keep = path.join(root, "node_modules/keep/pkg.js");
    const drop = path.join(root, "node_modules/drop/legacy.js");
    const added = path.join(root, "node_modules/extra/wasm.wasm");
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.mkdirSync(path.dirname(drop), { recursive: true });
    fs.mkdirSync(path.dirname(added), { recursive: true });
    fs.writeFileSync(keep, "keep");
    fs.writeFileSync(drop, "drop");
    fs.writeFileSync(added, "added");

    const nftPath = path.join(nftDir, "route.js.nft.json");
    fs.writeFileSync(
      nftPath,
      JSON.stringify({
        version: 1,
        files: [
          "../../../../../node_modules/keep/pkg.js",
          "../../../../../node_modules/drop/legacy.js",
        ],
      }),
    );

    const files = buildEffectiveTraceSet({
      repoRoot: root,
      nftJsonPath: nftPath,
      includes: ["./node_modules/extra/wasm.wasm"],
      excludes: ["./node_modules/drop/legacy.js"],
    });

    expect([...files].map((p) => path.basename(p)).sort()).toEqual([
      "pkg.js",
      "wasm.wasm",
    ]);
  });
});

describe("summarizeTraceFiles", () => {
  it("groups sizes by npm package name", () => {
    const root = tempRoot();
    const pkgDir = path.join(root, "node_modules/ffmpeg-static");
    fs.mkdirSync(pkgDir, { recursive: true });
    const bin = path.join(pkgDir, "ffmpeg");
    fs.writeFileSync(bin, "x".repeat(1024));

    const summary = summarizeTraceFiles(root, new Set([bin]));
    expect(summary.totalBytes).toBe(1024);
    expect(summary.breakdown[0]).toEqual({
      name: "ffmpeg-static",
      bytes: 1024,
    });
  });
});
