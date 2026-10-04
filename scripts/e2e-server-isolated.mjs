import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { createE2eRuntimeEnv } from "./e2e-runtime.mjs";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const FORCE_KILL_DELAY_MS = 5_000;

export async function runIsolatedE2eServer({
  spawnImpl = spawn,
  killImpl = process.kill.bind(process),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  registerSignal = (signal, handler) => process.on(signal, handler),
  unregisterSignal = (signal, handler) => process.off(signal, handler),
  sourceEnv = process.env,
} = {}) {
  const env = createE2eRuntimeEnv(sourceEnv);
  const isWindows = process.platform === "win32";
  const npmBin = isWindows ? "npm.cmd" : "npm";

  let activeChild = null;
  let terminating = false;
  let forceKillTimer = null;

  const clearForceKill = () => {
    if (forceKillTimer !== null) {
      clearTimeoutImpl(forceKillTimer);
      forceKillTimer = null;
    }
  };

  const killChild = (child, signal) => {
    try {
      if (isWindows) {
        child.kill(signal);
      } else {
        killImpl(child.pid, signal);
      }
    } catch (error) {
      if (!error || error.code !== "ESRCH") {
        throw error;
      }
    }
  };

  const onSignal = (signal) => {
    terminating = true;
    const child = activeChild;
    if (!child || child.exitCode !== null) {
      return;
    }
    killChild(child, signal);
    clearForceKill();
    forceKillTimer = setTimeoutImpl(() => {
      forceKillTimer = null;
      killChild(child, "SIGKILL");
    }, FORCE_KILL_DELAY_MS);
  };

  const registrations = [];
  for (const signal of SIGNALS) {
    const handler = () => onSignal(signal);
    registerSignal(signal, handler);
    registrations.push([signal, handler]);
  }
  const removeSignalHandlers = () => {
    for (const [signal, handler] of registrations.splice(0)) {
      unregisterSignal(signal, handler);
    }
  };

  const launch = (command, args) => {
    const child = spawnImpl(command, args, {
      stdio: "inherit",
      env,
      shell: false,
      detached: false,
    });
    activeChild = child;
    return new Promise((resolve) => {
      child.once("error", () => {
        if (activeChild === child) {
          activeChild = null;
        }
        clearForceKill();
        resolve(1);
      });
      child.once("exit", (code, signal) => {
        if (activeChild === child) {
          activeChild = null;
        }
        clearForceKill();
        resolve(code ?? (signal ? 1 : 0));
      });
    });
  };

  try {
    const buildCode = await launch(npmBin, ["run", "build"]);
    if (terminating) {
      return 1;
    }
    if (buildCode !== 0) {
      return buildCode || 1;
    }
    const serverCode = await launch(process.execPath, [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      env.PLAYWRIGHT_E2E_PORT,
    ]);
    return serverCode ?? 1;
  } finally {
    clearForceKill();
    removeSignalHandlers();
  }
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runIsolatedE2eServer()
    .then((code) => process.exit(code))
    .catch(() => {
      console.error("isolated e2e server exited abnormally");
      process.exit(1);
    });
}
