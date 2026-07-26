import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { isMissingSchemaError, postgresErrorCode } from "@/lib/db/error-message";

type RouteHandler = (
  req: NextRequest,
  ctx?: unknown,
) => Promise<Response> | Response;

function postgresErrorResponse(err: unknown): NextResponse | null {
  const code = postgresErrorCode(err);
  if (code === "23505") {
    return NextResponse.json(
      { error: "Conflict", code },
      { status: 409 },
    );
  }
  if (code === "23503") {
    return NextResponse.json(
      { error: "Conflict", code },
      { status: 409 },
    );
  }
  if (isMissingSchemaError(err)) {
    Sentry.captureException(err, { tags: { cause: "schema_drift" } });
    return NextResponse.json(
      { error: "Server configuration error", code: "schema_drift" },
      { status: 500 },
    );
  }
  return null;
}

/** Wrap API route handlers with postgres error mapping and Sentry capture. */
export function withApiErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      const mapped = postgresErrorResponse(err);
      if (mapped) return mapped;
      Sentry.captureException(err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  };
}

export { postgresErrorResponse };
