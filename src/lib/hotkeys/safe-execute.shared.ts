import type { PageHotkeyHandler } from "@/lib/hotkeys/types";

/**
 * Run a hotkey handler without letting failures escape to the global error boundary.
 * Logs action id only — never user data.
 */
export async function safeRunHotkeyHandler(
  actionId: string,
  handler: PageHotkeyHandler | undefined,
): Promise<void> {
  if (!handler) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[hotkeys] No handler registered for action: ${actionId}`);
    }
    return;
  }

  try {
    await handler();
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[hotkeys] Handler failed for action: ${actionId}`, error);
    }
  }
}

export function safeRunHotkeyDispatch(
  actionId: string,
  run: () => void | Promise<void>,
): void {
  void (async () => {
    try {
      await run();
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error(`[hotkeys] Dispatch failed for action: ${actionId}`, error);
      }
    }
  })();
}
