import { execFileSync } from "node:child_process";

export function gitExec(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function gitExecOptional(args: string[], cwd?: string): string | null {
  try {
    return gitExec(args, cwd);
  } catch {
    return null;
  }
}

export function listTagsMatching(prefix: string, cwd?: string): string[] {
  const output = gitExecOptional(["tag", "-l", `${prefix}*`], cwd);
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function resolveLatestTag(cwd?: string): string | null {
  const tags = listTagsMatching("v", cwd);
  if (tags.length === 0) {
    return null;
  }

  return (
    tags
      .sort((a, b) => {
        const av = a.replace(/^v/i, "");
        const bv = b.replace(/^v/i, "");
        return av.localeCompare(bv, undefined, { numeric: true });
      })
      .at(-1) ?? null
  );
}

export type TagDiffCommit = {
  hash: string;
  subject: string;
  body: string;
};

export type TagDiffReleaseInputs = {
  sinceTag: string;
  untilTag: string | "HEAD";
  commits: TagDiffCommit[];
  changedFiles: string[];
  ghReleaseBody: string | null;
};

export function extractTagDiffReleaseInputs(options: {
  sinceTag: string;
  untilTag?: string | "HEAD";
  cwd?: string;
  ghReleaseBody?: string | null;
}): TagDiffReleaseInputs {
  return extractCommitRangeReleaseInputs({
    sinceRef: options.sinceTag,
    untilRef: options.untilTag ?? "HEAD",
    cwd: options.cwd,
    ghReleaseBody: options.ghReleaseBody,
  });
}

export function extractCommitRangeReleaseInputs(options: {
  sinceRef?: string | null;
  untilRef: string;
  cwd?: string;
  ghReleaseBody?: string | null;
  noMerges?: boolean;
}): TagDiffReleaseInputs {
  const untilRef = options.untilRef;
  const logArgs = ["log"];

  if (options.sinceRef) {
    logArgs.push(`${options.sinceRef}..${untilRef}`);
  } else {
    logArgs.push(untilRef);
  }

  if (options.noMerges !== false) {
    logArgs.push("--no-merges");
  }

  logArgs.push("--pretty=format:%H%x1f%s%x1f%b%x1e");

  const logOutput = gitExecOptional(logArgs, options.cwd) ?? "";

  const commits: TagDiffCommit[] = [];
  for (const record of logOutput.split("\x1e").filter(Boolean)) {
    const [hash, subject, body] = record.split("\x1f");
    if (!hash) {
      continue;
    }

    commits.push({
      hash,
      subject: subject ?? "",
      body: (body ?? "").trim(),
    });
  }

  const diffArgs = options.sinceRef
    ? ["diff", "--name-only", `${options.sinceRef}..${untilRef}`]
    : ["diff", "--name-only", untilRef];

  const diffOutput = gitExecOptional(diffArgs, options.cwd) ?? "";
  const changedFiles = diffOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    sinceTag: options.sinceRef ?? "",
    untilTag: untilRef,
    commits,
    changedFiles,
    ghReleaseBody: options.ghReleaseBody ?? null,
  };
}

export function tryFetchGhReleaseBody(tag: string): string | null {
  const output = gitExecOptional([
    "gh",
    "release",
    "view",
    tag,
    "--json",
    "body",
    "--jq",
    ".body",
  ]);
  return output?.trim() ? output.trim() : null;
}

export function tryFetchGhReleasePublishedAt(tag: string): string | null {
  const output = gitExecOptional([
    "gh",
    "release",
    "view",
    tag,
    "--json",
    "publishedAt",
    "--jq",
    ".publishedAt",
  ]);
  return output?.trim() ? output.trim() : null;
}

export function getTagDate(tag: string, cwd?: string): string | null {
  const output = gitExecOptional(
    ["log", "-1", "--format=%cI", tag],
    cwd,
  );
  return output?.trim() ? output.trim() : null;
}
