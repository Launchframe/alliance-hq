import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTesseractWorkerOptions } from "@/lib/members/roster-ocr/tesseract";
import { expandTracingPatterns } from "../../../../scripts/vercel/trace-size.shared.mjs";
import {
  tesseractFileTracing,
  tesseractWorkerNodePackageTracing,
} from "../../../../scripts/vercel/video-ocr-file-tracing.mjs";

const NODE_BUILTIN_MODULES = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "http",
  "https",
  "module",
  "os",
  "path",
  "punycode",
  "stream",
  "string_decoder",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

function packageNameFromRequire(req: string): string | null {
  if (!req || req.startsWith(".") || req.startsWith("/") || req.startsWith("node:")) {
    return null;
  }
  if (NODE_BUILTIN_MODULES.has(req.split("/")[0]!)) return null;
  if (req.startsWith("@")) {
    const parts = req.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return req.split("/")[0] ?? null;
}

function resolveRelativeRequire(fromFile: string, req: string): string | null {
  if (!req.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), req);
  if (existsSync(base)) {
    try {
      if (statSync(base).isFile()) return base;
    } catch {
      /* fall through */
    }
  }
  if (existsSync(`${base}.js`)) return `${base}.js`;
  if (existsSync(path.join(base, "index.js"))) return path.join(base, "index.js");
  return null;
}

function resolvePackageEntry(repoRoot: string, pkg: string, subpath?: string): string | null {
  const pkgRoot = path.join(repoRoot, "node_modules", pkg);
  if (subpath) {
    const base = path.join(pkgRoot, subpath);
    if (existsSync(base) && statSync(base).isFile()) return base;
    if (existsSync(`${base}.js`)) return `${base}.js`;
    if (existsSync(path.join(base, "index.js"))) return path.join(base, "index.js");
    return null;
  }
  const pkgJsonPath = path.join(pkgRoot, "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    main?: string;
  };
  const main = pkgJson.main ?? "index.js";
  const mainPath = path.join(pkgRoot, main);
  if (existsSync(mainPath)) return mainPath;
  if (existsSync(`${mainPath}.js`)) return `${mainPath}.js`;
  if (existsSync(path.join(pkgRoot, "index.js"))) return path.join(pkgRoot, "index.js");
  return null;
}

/** Walk worker-script/node entry; collect tesseract.js/src/* files it requires outside worker-script/. */
function collectWorkerThreadExternalRequires(): string[] {
  const repoRoot = path.resolve(import.meta.dirname, "../../../..");
  const tesseractRoot = path.dirname(
    path.join(repoRoot, "node_modules/tesseract.js/package.json"),
  );
  const workerScriptDir = path.join(tesseractRoot, "src/worker-script");
  const srcPrefix = path.join(tesseractRoot, "src") + path.sep;

  const visited = new Set<string>();
  const queue = [path.join(workerScriptDir, "node/index.js")];
  const external = new Set<string>();

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const req = match[1];
      if (!req?.startsWith(".")) continue;
      const resolved = resolveRelativeRequire(file, req);
      if (!resolved) continue;
      if (
        resolved.startsWith(workerScriptDir + path.sep) ||
        resolved === path.join(workerScriptDir, "index.js")
      ) {
        queue.push(resolved);
      } else if (resolved.startsWith(srcPrefix)) {
        external.add(path.normalize(resolved));
      }
    }
  }

  return [...external].sort();
}

/**
 * Package names reachable from the Node worker entry via require(), including
 * transitive deps of those packages (e.g. node-fetch → whatwg-url).
 */
function collectWorkerThreadPackageRequires(): string[] {
  const repoRoot = path.resolve(import.meta.dirname, "../../../..");
  const tesseractRoot = path.join(repoRoot, "node_modules/tesseract.js");
  const workerScriptDir = path.join(tesseractRoot, "src/worker-script");
  const nmPrefix = path.join(repoRoot, "node_modules") + path.sep;

  const visited = new Set<string>();
  const queue = [path.join(workerScriptDir, "node/index.js")];
  const packages = new Set<string>();

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);

    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const req = match[1];
      if (!req) continue;

      if (req.startsWith(".")) {
        const resolved = resolveRelativeRequire(file, req);
        if (!resolved) continue;
        if (
          resolved.startsWith(workerScriptDir + path.sep) ||
          resolved === path.join(workerScriptDir, "index.js") ||
          resolved.startsWith(nmPrefix)
        ) {
          queue.push(resolved);
        }
        continue;
      }

      const pkg = packageNameFromRequire(req);
      if (!pkg || pkg === "tesseract.js-core") continue;

      // Optional peer deps (e.g. node-fetch → encoding) may not be installed.
      const subpath = req.slice(pkg.length).replace(/^\//, "") || undefined;
      const entry = resolvePackageEntry(repoRoot, pkg, subpath);
      if (!entry) continue;

      packages.add(pkg);
      queue.push(entry);
    }
  }

  return [...packages].sort();
}

const recognizeState = { active: 0, maxConcurrent: 0 };

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(async () => ({
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async () => {
      recognizeState.active += 1;
      recognizeState.maxConcurrent = Math.max(
        recognizeState.maxConcurrent,
        recognizeState.active,
      );
      await new Promise((resolve) => setTimeout(resolve, 15));
      recognizeState.active -= 1;
      return {
        data: {
          blocks: [
            {
              paragraphs: [
                {
                  lines: [{ text: "R5 Player", confidence: 90 }],
                },
              ],
            },
          ],
        },
      };
    }),
    terminate: vi.fn(async () => undefined),
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildTesseractWorkerOptions", () => {
  it("omits langPath by default so tesseract.js uses CDN traineddata", () => {
    vi.stubEnv("TESSERACT_LANG_PATH", "");
    const options = buildTesseractWorkerOptions();
    expect(options.langPath).toBeUndefined();
    // Must be a real filesystem string — Turbopack module ids break Worker().
    expect(typeof options.workerPath).toBe("string");
    expect(options.workerPath).toMatch(/[/\\]worker-script[/\\]node[/\\]index\.js$/);
    expect(existsSync(options.workerPath)).toBe(true);
  });

  it("resolves workerPath via package.json so bundlers cannot rewrite it to a module id", () => {
    const options = buildTesseractWorkerOptions();
    expect(Number.isFinite(Number(options.workerPath))).toBe(false);
    expect(options.workerPath.includes("node_modules")).toBe(true);
  });

  it("keeps worker-script relative requires on disk (NFT must ship constants/)", () => {
    const options = buildTesseractWorkerOptions();
    const workerDir = path.dirname(options.workerPath);
    // dump.js → ../../constants/imageType; getCore.js → ../../constants/OEM
    expect(
      existsSync(path.join(workerDir, "../../constants/imageType.js")),
    ).toBe(true);
    expect(existsSync(path.join(workerDir, "../../constants/OEM.js"))).toBe(true);
  });

  it("passes trimmed TESSERACT_LANG_PATH when set", () => {
    vi.stubEnv(
      "TESSERACT_LANG_PATH",
      "  https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int  ",
    );
    expect(buildTesseractWorkerOptions().langPath).toBe(
      "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int",
    );
  });
});

describe("tesseractFileTracing", () => {
  it("includes constants required by the worker thread (not only worker-script/)", () => {
    expect(tesseractFileTracing).toEqual(
      expect.arrayContaining([
        "./node_modules/tesseract.js/src/constants/**/*",
        "./node_modules/tesseract.js/src/utils/**/*",
        "./node_modules/tesseract.js/src/worker-script/**/*",
      ]),
    );
  });

  it("includes Node worker npm packages (bmp-js et al.) NFT cannot see across threads", () => {
    expect(tesseractWorkerNodePackageTracing).toEqual(
      expect.arrayContaining([
        "./node_modules/bmp-js/**/*",
        "./node_modules/is-url/**/*",
        "./node_modules/regenerator-runtime/**/*",
        "./node_modules/node-fetch/**/*",
      ]),
    );
    expect(tesseractFileTracing).toEqual(
      expect.arrayContaining(tesseractWorkerNodePackageTracing),
    );
  });

  it("covers every tesseract.js/src file the worker thread reaches via relative require", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../..");
    const traced = expandTracingPatterns(repoRoot, tesseractFileTracing);
    const externalRequires = collectWorkerThreadExternalRequires();
    expect(externalRequires.length).toBeGreaterThan(0);

    const uncovered = externalRequires.filter((file) => !traced.has(file));
    expect(uncovered).toEqual([]);
  });

  it("covers every npm package the Node worker thread require()s", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../..");
    const packages = collectWorkerThreadPackageRequires();
    expect(packages).toEqual(expect.arrayContaining(["bmp-js", "is-url", "regenerator-runtime"]));

    const uncovered = packages.filter(
      (pkg) =>
        !tesseractFileTracing.some(
          (pattern) =>
            pattern === `./node_modules/${pkg}/**/*` ||
            pattern.startsWith(`./node_modules/${pkg}/`),
        ),
    );
    expect(uncovered).toEqual([]);

    // Patterns must expand on disk so Vercel actually ships the modules.
    const traced = expandTracingPatterns(repoRoot, tesseractFileTracing);
    for (const pkg of packages) {
      const pkgRoot = path.join(repoRoot, "node_modules", pkg) + path.sep;
      const hit = [...traced].some((file) => file.startsWith(pkgRoot));
      expect(hit, `expected traced files under node_modules/${pkg}`).toBe(true);
    }
  });
});

describe("runTesseract", () => {
  beforeEach(() => {
    recognizeState.active = 0;
    recognizeState.maxConcurrent = 0;
  });

  afterEach(async () => {
    const { terminateTesseractWorker } = await import("@/lib/members/roster-ocr/tesseract");
    await terminateTesseractWorker();
    vi.resetModules();
  });

  it("serializes concurrent recognize() calls on the shared worker", async () => {
    const { runTesseract } = await import("@/lib/members/roster-ocr/tesseract");
    const imageBuffer = Buffer.from("fake-png");

    await Promise.all([
      runTesseract(imageBuffer),
      runTesseract(imageBuffer),
      runTesseract(imageBuffer),
    ]);

    expect(recognizeState.maxConcurrent).toBe(1);
  });
});
