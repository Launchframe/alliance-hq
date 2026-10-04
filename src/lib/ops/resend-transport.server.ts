import "server-only";

import {
  PRODUCTION_EMAIL_FROM,
  RESEND_DEV_EMAIL_FROM,
} from "@/lib/public-site";

export type ResendDeliveryResult =
  | { sent: true }
  | {
      sent: false;
      reason:
        | "missing_key"
        | "missing_recipients"
        | "disabled"
        | "timeout"
        | "transport"
        | "provider";
      retryable: boolean;
    };

export async function sendResendMessage(input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}): Promise<ResendDeliveryResult> {
  if (process.env.E2E_TEST === "true") {
    return { sent: false, reason: "disabled", retryable: false };
  }
  if (input.to.length === 0) {
    return { sent: false, reason: "missing_recipients", retryable: false };
  }
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { sent: false, reason: "missing_key", retryable: false };
  }
  const from =
    process.env.EMAIL_FROM ??
    (process.env.NODE_ENV === "production"
      ? PRODUCTION_EMAIL_FROM
      : RESEND_DEV_EMAIL_FROM);

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { sent: false, reason: "timeout", retryable: true };
    }
    return { sent: false, reason: "transport", retryable: true };
  }

  if (response.ok) {
    return { sent: true };
  }
  return {
    sent: false,
    reason: "provider",
    retryable: response.status === 429 || response.status >= 500,
  };
}
