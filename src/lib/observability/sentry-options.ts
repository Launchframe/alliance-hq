import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "@/lib/observability/scrub";

function sentryEnvironment(): string {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV;
  if (process.env.NODE_ENV === "production") return "production";
  return "development";
}

function sentryDsn(): string | undefined {
  return process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
}

export function baseSentryOptions(): Parameters<typeof Sentry.init>[0] {
  const dsn = sentryDsn();
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: sentryEnvironment(),
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    beforeSend: (event, hint) =>
      scrubSentryEvent(
        event as Parameters<typeof scrubSentryEvent>[0],
        hint,
      ) as typeof event | null,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "Non-Error promise rejection captured",
    ],
  };
}
