import fs from "node:fs";
import path from "node:path";

function envPaths(cwd = process.cwd()) {
  return {
    local: path.join(cwd, ".env.local"),
    backup: path.join(cwd, ".env.local.e2e-bak"),
  };
}

export const ENV_LOCAL = envPaths().local;
export const ENV_BACKUP = envPaths().backup;

// First line of every generated .env.local. Restore uses this to tell a
// throwaway generated file apart from the developer's real one, so a restore
// from any process (or after a hard kill) never deletes real config.
export const AUTOGEN_MARKER = "# Playwright E2E — auto-generated";

function readsAsAutogen(file) {
  try {
    return fs.readFileSync(file, "utf8").startsWith(AUTOGEN_MARKER);
  } catch {
    return false;
  }
}

/**
 * Move the developer's real .env.local aside (to ENV_BACKUP) so the caller can
 * write a generated one. Self-healing and idempotent: if a stale backup is
 * present from a previous run that was killed before it could restore, recover
 * it first so we never stack a generated file on top of another generated file
 * and lose the real config.
 *
 * Returns true when a real file was backed up.
 */
export function backupEnvFile(cwd = process.cwd()) {
  const { local, backup } = envPaths(cwd);

  // Recover a stranded real file from an earlier killed run.
  if (fs.existsSync(backup)) {
    if (fs.existsSync(local) && readsAsAutogen(local)) {
      fs.unlinkSync(local);
    }
    if (!fs.existsSync(local)) {
      fs.renameSync(backup, local);
    }
  }

  const hadOriginal = fs.existsSync(local) && !readsAsAutogen(local);
  if (hadOriginal) {
    fs.renameSync(local, backup);
  }
  return hadOriginal;
}

/**
 * Restore the developer's .env.local. Safe to call from any process, in any
 * order, any number of times — it derives everything from filesystem state:
 *
 *   - Backup present  → the real file is parked there; drop any generated
 *     leftover and move the backup back.
 *   - No backup, but .env.local is an auto-generated leftover (e.g. the server
 *     was SIGKILLed and there was no original) → delete the leftover.
 *   - Otherwise (already restored, or it's the real file) → do nothing.
 *
 * This is why both scripts/e2e-server.mjs (on exit/signal) and the Playwright
 * globalTeardown can call it: whichever runs first restores, the rest no-op.
 */
export function restoreEnvFile(cwd = process.cwd()) {
  const { local, backup } = envPaths(cwd);

  try {
    if (fs.existsSync(backup)) {
      if (fs.existsSync(local) && readsAsAutogen(local)) {
        fs.unlinkSync(local);
      }
      if (!fs.existsSync(local)) {
        fs.renameSync(backup, local);
      }
      return;
    }

    if (fs.existsSync(local) && readsAsAutogen(local)) {
      fs.unlinkSync(local);
    }
  } catch (err) {
    console.error(
      `Failed to restore .env.local; your original (if any) is preserved at ${backup}`,
      err,
    );
  }
}
