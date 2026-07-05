import type postgres from "postgres";

export type PostgresListenClient = ReturnType<typeof postgres>;

export type StartPostgresListenLifecycle = {
  isIntentionalClose: () => boolean;
  onDisconnect: () => void;
  /** Default 30_000. Set 0 to disable liveness probes. */
  probeIntervalMs?: number;
};

const DEFAULT_PROBE_INTERVAL_MS = 30_000;

/**
 * postgres.js `.listen()` rejects when the connection cannot authenticate.
 * SSE routes must catch that promise — otherwise a Neon credential rotation
 * window becomes an unhandled rejection and can fatal the Node process on Vercel.
 *
 * After a successful LISTEN, postgres.js may silently fail to re-subscribe when
 * the dedicated connection drops (internal `.catch(() => noop)`). A lightweight
 * `select 1` probe detects that zombie state so the SSE stream can close and
 * the client can open a fresh request (new serverless instance + env).
 */
export async function startPostgresListen(
  listenClient: PostgresListenClient,
  channel: string,
  onPayload: (payload: string) => void,
  onError: (error: unknown) => void,
  lifecycle?: StartPostgresListenLifecycle,
): Promise<() => void> {
  const stopProbe = lifecycle
    ? attachPostgresListenProbe(listenClient, lifecycle)
    : () => undefined;

  try {
    await listenClient.listen(channel, onPayload);
  } catch (error) {
    stopProbe();
    console.error("[postgres-listen] LISTEN failed:", error);
    try {
      onError(error);
    } catch (handlerError) {
      console.error("[postgres-listen] onError handler failed:", handlerError);
    }
    await listenClient.end({ timeout: 0 }).catch(() => undefined);
  }

  return stopProbe;
}

export function attachPostgresListenProbe(
  listenClient: Pick<PostgresListenClient, "unsafe">,
  options: StartPostgresListenLifecycle,
): () => void {
  const intervalMs = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  if (intervalMs <= 0) {
    return () => undefined;
  }

  let disconnectHandled = false;

  const handleProbeFailure = (error: unknown) => {
    if (options.isIntentionalClose() || disconnectHandled) {
      return;
    }
    disconnectHandled = true;
    stop();
    console.error("[postgres-listen] connection probe failed:", error);
    try {
      options.onDisconnect();
    } catch (handlerError) {
      console.error(
        "[postgres-listen] onDisconnect handler failed:",
        handlerError,
      );
    }
  };

  const timer = setInterval(() => {
    if (options.isIntentionalClose()) {
      return;
    }
    void listenClient.unsafe("select 1").catch(handleProbeFailure);
  }, intervalMs);

  const stop = () => {
    clearInterval(timer);
  };

  return stop;
}
