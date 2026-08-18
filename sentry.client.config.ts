import * as Sentry from "@sentry/nextjs";

import { baseSentryOptions } from "@/lib/observability/sentry-options";

Sentry.init(baseSentryOptions());
