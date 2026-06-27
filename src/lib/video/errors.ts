/**
 * Thrown when a video job reaches processing without a usable Ashed credential.
 * This is a recoverable state — the job is reverted to `pending_approval` so a
 * connected processor can re-approve it — not a pipeline failure.
 */
export class AshedNotConnectedError extends Error {
  readonly code = "ashed_not_connected" as const;

  constructor(message = "Ashed not connected for the processing session.") {
    super(message);
    this.name = "AshedNotConnectedError";
  }
}

export function isAshedNotConnectedError(
  error: unknown,
): error is AshedNotConnectedError {
  return error instanceof AshedNotConnectedError;
}
