import { isRedirectError } from "next/dist/client/components/redirect-error";

/** Rethrow Next.js navigation redirects — they must not be caught as errors. */
export function rethrowNavigationError(error: unknown): void {
  if (isRedirectError(error)) {
    throw error;
  }
}
