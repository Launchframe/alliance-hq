import type postgres from "postgres";

type PostgresListenClient = Pick<
  ReturnType<typeof postgres>,
  "listen" | "end"
>;

/**
 * postgres.js `.listen()` rejects when the connection cannot authenticate.
 * SSE routes must catch that promise — otherwise a Neon credential rotation
 * window becomes an unhandled rejection and can fatal the Node process on Vercel.
 */
export async function startPostgresListen(
  listenClient: PostgresListenClient,
  channel: string,
  onPayload: (payload: string) => void,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await listenClient.listen(channel, onPayload);
  } catch (error) {
    console.error("[postgres-listen] LISTEN failed:", error);
    try {
      onError(error);
    } catch (handlerError) {
      console.error("[postgres-listen] onError handler failed:", handlerError);
    }
    await listenClient.end({ timeout: 0 }).catch(() => undefined);
  }
}
