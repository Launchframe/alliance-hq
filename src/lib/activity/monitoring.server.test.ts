import { waitUntil } from "@vercel/functions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as dbModule from "@/lib/db";
import * as transportModule from "@/lib/ops/resend-transport.server";

import { ActivityWriteError } from "./errors.server";
import {
  dispatchActivityBlockedAlert,
  scheduleActivityBlockedAlert,
} from "./monitoring.server";

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));

vi.mock("@/lib/ops/resend-transport.server", () => ({
  sendResendMessage: vi.fn(),
}));

const sendMock = vi.mocked(transportModule.sendResendMessage);
const waitUntilMock = vi.mocked(waitUntil);

const recipients = [
  { email: "maintainer-en@example.com", locale: "en-US" },
  { email: "maintainer-pt@example.com", locale: "pt-BR" },
];

const writeError = () =>
  new ActivityWriteError({
    eventKey: "thp.submitted",
    failureCategory: "constraint",
    sqlState: "23505",
  });

const WINDOW_START = new Date("2026-09-29T12:00:00.000Z");
const NEXT_WINDOW = new Date("2026-09-29T12:05:00.000Z");

function loggedText() {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => call.map(String).join(" "))
    .join("\n");
}

describe("dispatchActivityBlockedAlert", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ACTIVITY_ALERT_RECIPIENTS", JSON.stringify(recipients));
    vi.stubEnv("VERCEL_ENV", "test");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL", "");
    sendMock.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns false and logs critical without config contents when recipients are missing", async () => {
    vi.stubEnv("ACTIVITY_ALERT_RECIPIENTS", "");
    const result = await dispatchActivityBlockedAlert(
      writeError(),
      WINDOW_START,
    );
    expect(result).toEqual({ sent: false, recipientCount: 0 });
    expect(sendMock).not.toHaveBeenCalled();

    const logs = loggedText();
    expect(logs).toContain("activity_write_blocked_action");
    expect(logs).toContain("activity_alert_delivery_failed");
    expect(logs).toContain("missing_recipients");
  });

  it("returns false for invalid recipient JSON without printing config", async () => {
    vi.stubEnv(
      "ACTIVITY_ALERT_RECIPIENTS",
      '[{"email":"not-an-email-secret@example.com","locale":"fr-FR"}]',
    );
    const result = await dispatchActivityBlockedAlert(
      writeError(),
      WINDOW_START,
    );
    expect(result.sent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(
      "not-an-email-secret@example.com",
    );
  });

  it("sends one localized message per recipient without touching the DB", async () => {
    const getDbSpy = vi.spyOn(dbModule, "getDb");
    const result = await dispatchActivityBlockedAlert(
      writeError(),
      WINDOW_START,
    );

    expect(result).toEqual({ sent: true, recipientCount: 2 });
    expect(getDbSpy).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(2);

    const [enRequest, ptRequest] = sendMock.mock.calls.map((call) => call[0]);
    expect(enRequest.to).toEqual(["maintainer-en@example.com"]);
    expect(enRequest.subject).toBe(
      "[Alliance HQ] Activity recording blocked a user action",
    );
    expect(enRequest.text).toContain("Incident:");
    expect(enRequest.text).toContain("Action: thp.submitted");
    expect(enRequest.text).toContain("Failure category: constraint");
    expect(enRequest.text).toContain("Alert window: 2026-09-29T12:00:00.000Z");

    expect(ptRequest.to).toEqual(["maintainer-pt@example.com"]);
    expect(ptRequest.subject).toBe(
      "[Alliance HQ] O registro de atividade bloqueou uma ação do usuário",
    );
    expect(ptRequest.text).toContain("Incidente:");
    expect(ptRequest.text).toContain("Ação: thp.submitted");
    expect(ptRequest.text).toContain("Categoria da falha: constraint");
  });

  it("escapes HTML values and keeps markup limited to paragraph tags", async () => {
    await dispatchActivityBlockedAlert(writeError(), WINDOW_START);
    const request = sendMock.mock.calls[0][0];
    const withoutTags = request.html.replace(/<\/?p>/g, "");
    expect(withoutTags).not.toMatch(/[<>]/);
    expect(withoutTags).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/);
    expect(request.html.startsWith("<p>")).toBe(true);
    expect(request.html.endsWith("</p>")).toBe(true);
    expect(request.html).not.toContain("maintainer-en@example.com");
  });

  it("does not retry a terminal provider failure", async () => {
    sendMock.mockResolvedValue({
      sent: false,
      reason: "provider",
      retryable: false,
    });
    const result = await dispatchActivityBlockedAlert(
      writeError(),
      WINDOW_START,
    );
    expect(result.sent).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(recipients.length);
    expect(loggedText()).toContain(
      "activity_alert_delivery_failed",
    );
  });

  it("retries a retryable failure once then gives up", async () => {
    sendMock.mockResolvedValue({
      sent: false,
      reason: "timeout",
      retryable: true,
    });
    const result = await dispatchActivityBlockedAlert(
      writeError(),
      WINDOW_START,
    );
    expect(result.sent).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(recipients.length * 2);
  });

  it("reports a transport missing_key result as not sent", async () => {
    sendMock.mockResolvedValue({
      sent: false,
      reason: "missing_key",
      retryable: false,
    });
    const result = await dispatchActivityBlockedAlert(
      writeError(),
      WINDOW_START,
    );
    expect(result.sent).toBe(false);
    expect(loggedText()).toContain("missing_key");
  });

  it("keeps idempotency keys stable within a window and distinct across windows and recipients", async () => {
    const error = writeError();
    await dispatchActivityBlockedAlert(error, WINDOW_START);
    const firstKeys = sendMock.mock.calls.map((call) => call[0].idempotencyKey);

    sendMock.mockClear();
    await dispatchActivityBlockedAlert(error, WINDOW_START);
    const repeatKeys = sendMock.mock.calls.map(
      (call) => call[0].idempotencyKey,
    );
    expect(repeatKeys).toEqual(firstKeys);
    expect(new Set(firstKeys).size).toBe(recipients.length);

    sendMock.mockClear();
    await dispatchActivityBlockedAlert(error, NEXT_WINDOW);
    const nextWindowKeys = sendMock.mock.calls.map(
      (call) => call[0].idempotencyKey,
    );
    expect(nextWindowKeys[0]).not.toBe(firstKeys[0]);
  });

  it("keeps request bodies stable within a window", async () => {
    const error = writeError();
    await dispatchActivityBlockedAlert(error, WINDOW_START);
    const firstBody = sendMock.mock.calls[0][0].text;
    sendMock.mockClear();
    await dispatchActivityBlockedAlert(writeError(), WINDOW_START);
    expect(sendMock.mock.calls[0][0].text).toBe(firstBody);
  });

  it("logs no recipient emails or incident payloads in alert signals", async () => {
    sendMock.mockResolvedValue({
      sent: false,
      reason: "provider",
      retryable: false,
    });
    await dispatchActivityBlockedAlert(writeError(), WINDOW_START);
    const logs = loggedText();
    expect(logs).toContain("activity_write_blocked_action");
    expect(logs).not.toContain("maintainer-en@example.com");
    expect(logs).not.toContain("maintainer-pt@example.com");
  });

  it("issues every recipient request before resolving any send", async () => {
    const resolvers: Array<(value: { sent: true }) => void> = [];
    sendMock.mockImplementation(
      () =>
        new Promise<{ sent: true }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const pending = dispatchActivityBlockedAlert(writeError(), WINDOW_START);
    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalledTimes(recipients.length);
    });
    resolvers.forEach((resolve) => resolve({ sent: true }));
    await expect(pending).resolves.toEqual({
      sent: true,
      recipientCount: recipients.length,
    });
  });

  it("counts partial delivery when one transport rejects", async () => {
    sendMock
      .mockRejectedValueOnce(new Error("socket exploded with secret"))
      .mockResolvedValue({ sent: true });
    const result = await dispatchActivityBlockedAlert(
      writeError(),
      WINDOW_START,
    );
    expect(result).toEqual({ sent: false, recipientCount: 1 });
    expect(sendMock).toHaveBeenCalledTimes(recipients.length);
    const logs = loggedText();
    expect(logs).toContain("activity_alert_delivery_failed");
    expect(logs).not.toContain("socket exploded");
  });
});

describe("scheduleActivityBlockedAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ACTIVITY_ALERT_RECIPIENTS", JSON.stringify(recipients));
    vi.stubEnv("VERCEL", "");
    sendMock.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("starts dispatch immediately without throwing", async () => {
    expect(() => scheduleActivityBlockedAlert(writeError())).not.toThrow();
    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalled();
    });
    expect(waitUntilMock).not.toHaveBeenCalled();
  });

  it("registers the dispatch task with waitUntil on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    scheduleActivityBlockedAlert(writeError());
    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    expect(waitUntilMock.mock.calls[0][0]).toBeInstanceOf(Promise);
    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalled();
    });
  });

  it("does not throw or replace the error when waitUntil registration fails", async () => {
    vi.stubEnv("VERCEL", "1");
    waitUntilMock.mockImplementation(() => {
      throw new Error("outside request context");
    });
    expect(() => scheduleActivityBlockedAlert(writeError())).not.toThrow();
    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalled();
    });
    const logs = loggedText();
    expect(logs).toContain("activity_alert_delivery_failed");
    expect(logs).toContain("lifecycle");
    expect(logs).not.toContain("outside request context");
  });
});
