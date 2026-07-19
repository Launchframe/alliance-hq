import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts/git-prune.sh");

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "git-prune-test-"));
  tempDirs.push(dir);
  return dir;
}

function gitEnv(extra = {}) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  return {
    ...env,
    GIT_AUTHOR_NAME: "git-prune test",
    GIT_AUTHOR_EMAIL: "git-prune@test.local",
    GIT_COMMITTER_NAME: "git-prune test",
    GIT_COMMITTER_EMAIL: "git-prune@test.local",
    ...extra,
  };
}

function runGit(cwd, args) {
  execFileSync("git", ["-C", cwd, ...args], {
    env: gitEnv(),
    stdio: "pipe",
  });
}

function writeFakeGh(root, prHeads) {
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const ghPath = path.join(binDir, "gh");
  const lines = prHeads.map((head) => `echo "${head}"`).join("\n");
  fs.writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "pr" && "$2" == "list" ]]; then
${lines || "  : # no open PR heads"}
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
    { mode: 0o755 },
  );
  return binDir;
}

function installScript(cloneRoot) {
  const scriptInClone = path.join(cloneRoot, "scripts/git-prune.sh");
  fs.mkdirSync(path.dirname(scriptInClone), { recursive: true });
  fs.copyFileSync(SCRIPT, scriptInClone);
  fs.chmodSync(scriptInClone, 0o755);
  return scriptInClone;
}

function runPrune(cloneRoot, args, { ghBinDir } = {}) {
  const scriptInClone = installScript(cloneRoot);
  const env = gitEnv();
  if (ghBinDir) {
    env.PATH = `${ghBinDir}:${env.PATH ?? ""}`;
  }
  return spawnSync("bash", [scriptInClone, ...args], {
    cwd: cloneRoot,
    env,
    encoding: "utf8",
  });
}

function initRepoWithGoneBranch(root) {
  const remote = path.join(root, "remote.git");
  const clone = path.join(root, "clone");
  fs.mkdirSync(root, { recursive: true });
  runGit(root, ["init", "--bare", "-b", "main", remote]);
  runGit(root, ["clone", remote, clone]);
  runGit(clone, ["commit", "--allow-empty", "-m", "init"]);
  runGit(clone, ["branch", "feat/stale"]);
  runGit(clone, ["push", "-u", "origin", "main", "feat/stale"]);
  runGit(remote, ["branch", "-D", "feat/stale"]);
  runGit(clone, ["fetch", "--prune", "origin"]);
  return clone;
}

describe.sequential("git-prune.sh", () => {
  it("--help exits 0 and documents dry-run default", () => {
    const out = execFileSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
    expect(out).toContain("dry-run");
    expect(out).toContain("--apply");
    expect(out).toContain("--worktrees");
  });

  it("refuses --apply without a TTY unless --yes", () => {
    const root = tempRoot();
    const clone = initRepoWithGoneBranch(root);
    const ghBin = writeFakeGh(root, []);

    const result = runPrune(clone, ["--apply"], { ghBinDir: ghBin });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing --apply without a TTY");
  });

  it("reports gone upstream branches for deletion in dry-run", () => {
    const root = tempRoot();
    const clone = initRepoWithGoneBranch(root);
    const ghBin = writeFakeGh(root, []);

    const result = runPrune(clone, [], { ghBinDir: ghBin });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("delete  feat/stale");
    expect(result.stdout).toContain("Dry-run only");
  });

  it("skips stale worktrees when the branch has an open PR", () => {
    const root = tempRoot();
    const clone = initRepoWithGoneBranch(root);
    const wtPath = path.join(root, "wt-stale");
    runGit(clone, ["worktree", "add", wtPath, "feat/stale"]);
    const ghBin = writeFakeGh(root, ["feat/stale"]);

    const result = runPrune(clone, ["--worktrees"], { ghBinDir: ghBin });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("feat/stale (open PR)");
    expect(result.stdout).not.toContain(`remove  ${wtPath}`);
    expect(fs.existsSync(wtPath)).toBe(true);
  });

  it("skips branch deletes when gh is unavailable", () => {
    const root = tempRoot();
    const clone = initRepoWithGoneBranch(root);
    const ghBin = path.join(root, "bin");
    fs.mkdirSync(ghBin, { recursive: true });
    fs.writeFileSync(
      path.join(ghBin, "gh"),
      `#!/usr/bin/env bash
echo gh unavailable >&2
exit 1
`,
      { mode: 0o755 },
    );

    const result = runPrune(clone, [], { ghBinDir: ghBin });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("gh unavailable");
    expect(result.stdout).toContain("feat/stale (gh unavailable)");
    expect(result.stdout).not.toContain("delete  feat/stale");
  });
});
