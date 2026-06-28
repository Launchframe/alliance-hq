import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AUTOGEN_MARKER,
  backupEnvFile,
  restoreEnvFile,
} from "./e2e-env-file.mjs";

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-env-file-"));
  tempDirs.push(dir);
  return dir;
}

function envLocal(root) {
  return path.join(root, ".env.local");
}

function envBackup(root) {
  return path.join(root, ".env.local.e2e-bak");
}

describe("e2e-env-file", () => {
  it("backs up a real .env.local and restore puts it back", () => {
    const root = tempRoot();
    fs.writeFileSync(envLocal(root), "REAL=1\n");

    expect(backupEnvFile(root)).toBe(true);
    expect(fs.existsSync(envBackup(root))).toBe(true);
    expect(fs.existsSync(envLocal(root))).toBe(false);

    fs.writeFileSync(
      envLocal(root),
      `${AUTOGEN_MARKER}\nGENERATED=1\n`,
    );

    restoreEnvFile(root);

    expect(fs.readFileSync(envLocal(root), "utf8")).toBe("REAL=1\n");
    expect(fs.existsSync(envBackup(root))).toBe(false);
  });

  it("self-heals when a stale backup and generated leftover coexist", () => {
    const root = tempRoot();
    fs.writeFileSync(envBackup(root), "REAL=1\n");
    fs.writeFileSync(
      envLocal(root),
      `${AUTOGEN_MARKER}\nGENERATED=1\n`,
    );

    expect(backupEnvFile(root)).toBe(true);

    expect(fs.readFileSync(envBackup(root), "utf8")).toBe("REAL=1\n");
    expect(fs.existsSync(envLocal(root))).toBe(false);
  });

  it("deletes a generated leftover when no backup exists", () => {
    const root = tempRoot();
    fs.writeFileSync(
      envLocal(root),
      `${AUTOGEN_MARKER}\nGENERATED=1\n`,
    );

    restoreEnvFile(root);

    expect(fs.existsSync(envLocal(root))).toBe(false);
  });

  it("restore is a no-op when the real file is already in place", () => {
    const root = tempRoot();
    fs.writeFileSync(envLocal(root), "REAL=1\n");

    restoreEnvFile(root);

    expect(fs.readFileSync(envLocal(root), "utf8")).toBe("REAL=1\n");
  });
});
