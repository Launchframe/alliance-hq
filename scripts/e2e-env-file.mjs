import fs from "node:fs";
import path from "node:path";

export const ENV_LOCAL = path.join(process.cwd(), ".env.local");
export const ENV_BACKUP = path.join(process.cwd(), ".env.local.e2e-bak");

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
export function backupEnvFile() {
  // Recover a stranded real file from an earlier killed run.
  if (fs.existsSync(ENV_BACKUP)) {
    if (fs.existsSync(ENV_LOCAL) && readsAsAutogen(ENV_LOCAL)) {
      fs.unlinkSync(ENV_LOCAL);
    }
    if (!fs.existsSync(ENV_LOCAL)) {
      fs.renameSync(ENV_BACKUP, ENV_LOCAL);
    }
  }

  const hadOriginal = fs.existsSync(ENV_LOCAL) && !readsAsAutogen(ENV_LOCAL);
  if (hadOriginal) {
    fs.renameSync(ENV_LOCAL, ENV_BACKUP);
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
export function restoreEnvFile() {
  try {
    if (fs.existsSync(ENV_BACKUP)) {
      if (fs.existsSync(ENV_LOCAL) && readsAsAutogen(ENV_LOCAL)) {
        fs.unlinkSync(ENV_LOCAL);
      }
      if (!fs.existsSync(ENV_LOCAL)) {
        fs.renameSync(ENV_BACKUP, ENV_LOCAL);
      }
      return;
    }

    if (fs.existsSync(ENV_LOCAL) && readsAsAutogen(ENV_LOCAL)) {
      fs.unlinkSync(ENV_LOCAL);
    }
  } catch (err) {
    console.error(
      `Failed to restore .env.local; your original (if any) is preserved at ${ENV_BACKUP}`,
      err,
    );
  }
}
