import fs from "node:fs";
import path from "node:path";

/**
 * Walk a directory recursively and return absolute file paths.
 */
export function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Expand a repo-root-relative glob used in outputFileTracingIncludes/Excludes.
 * Supports `/**` suffix recursion and exact file paths.
 */
export function expandTracingPattern(repoRoot, pattern) {
  const normalized = pattern.replace(/^\.\//, "");
  const abs = path.resolve(repoRoot, normalized);

  if (!normalized.includes("*")) {
    if (!fs.existsSync(abs)) {
      return [];
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      return [abs];
    }
    if (stat.isDirectory()) {
      return walkFiles(abs);
    }
    return [];
  }

  const recursiveSuffix = "/**/*";
  const idx = normalized.indexOf(recursiveSuffix);
  if (idx >= 0) {
    const dir = path.resolve(repoRoot, normalized.slice(0, idx));
    return walkFiles(dir);
  }

  throw new Error(`Unsupported tracing pattern: ${pattern}`);
}

export function expandTracingPatterns(repoRoot, patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    for (const file of expandTracingPattern(repoRoot, pattern)) {
      files.add(path.normalize(file));
    }
  }
  return files;
}

export function resolveNftFilePaths(nftJsonPath) {
  const nftDir = path.dirname(path.resolve(nftJsonPath));
  const nft = JSON.parse(fs.readFileSync(nftJsonPath, "utf8"));
  const files = new Set();
  for (const rel of nft.files ?? []) {
    files.add(path.normalize(path.resolve(nftDir, rel)));
  }
  return files;
}

export function fileSizeBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** Group traced files by top-level npm package for Vercel-style reporting. */
export function dependencyKeyForFile(repoRoot, filePath) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, "/");
  const nm = "node_modules/";
  const idx = rel.indexOf(nm);
  if (idx < 0) {
    if (rel.startsWith(".next/")) {
      return ".next";
    }
    return rel.split("/")[0] ?? rel;
  }
  const rest = rel.slice(idx + nm.length);
  if (rest.startsWith("@")) {
    const parts = rest.split("/");
    return parts.slice(0, 2).join("/");
  }
  return rest.split("/")[0];
}

export function summarizeTraceFiles(repoRoot, filePaths) {
  let totalBytes = 0;
  const byDependency = new Map();

  for (const filePath of filePaths) {
    const size = fileSizeBytes(filePath);
    if (size === 0) {
      continue;
    }
    totalBytes += size;
    const key = dependencyKeyForFile(repoRoot, filePath);
    byDependency.set(key, (byDependency.get(key) ?? 0) + size);
  }

  const breakdown = [...byDependency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({ name, bytes }));

  return { totalBytes, breakdown, fileCount: filePaths.size };
}

/**
 * Merge NFT trace + explicit includes − excludes (mirrors Next outputFileTracing).
 */
export function buildEffectiveTraceSet({
  repoRoot,
  nftJsonPath,
  includes = [],
  excludes = [],
}) {
  const files = resolveNftFilePaths(nftJsonPath);

  for (const file of expandTracingPatterns(repoRoot, includes)) {
    files.add(file);
  }

  const excluded = expandTracingPatterns(repoRoot, excludes);
  for (const file of excluded) {
    files.delete(file);
  }

  return files;
}

export function formatMegabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
