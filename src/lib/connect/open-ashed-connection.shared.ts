export const OPEN_ASHED_CONNECTION_EVENT = "alliance-hq-open-ashed-connection";

/** Chrome status chip in the shell header. */
export const ASHED_CONNECTION_STATUS_TEST_ID = "ashed-connection-status";

/**
 * Ask the shell Ashed chip to open its connect/reconnect panel.
 * Returns false when the chip is not mounted (first-time connect / no chrome).
 */
export function requestOpenAshedConnection(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const trigger = document.querySelector(
    `[data-testid="${ASHED_CONNECTION_STATUS_TEST_ID}"]`,
  );
  if (!trigger) {
    return false;
  }
  window.dispatchEvent(new Event(OPEN_ASHED_CONNECTION_EVENT));
  return true;
}
