import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendResendMessage } from "./resend-transport.server";

const message = {
  to: ["maintainer@example.com"],
  subject: "subject",
  text: "text body",
  html: "<p>html body</p>",
  idempotencyKey: "fp-1",
};

describe("sendResendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("E2E_TEST", "");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Alliance HQ <alerts@example.com>");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns disabled under E2E_TEST without calling fetch", async () => {
    vi.stubEnv("E2E_TEST", "true");
    const result = await sendResendMessage(message);
    expect(result).toEqual({
      sent: false,
      reason: "disabled",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns missing_key when the API key is absent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendResendMessage(message);
    expect(result).toEqual({
      sent: false,
      reason: "missing_key",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns missing_recipients for an empty recipient list", async () => {
    const result = await sendResendMessage({ ...message, to: [] });
    expect(result).toEqual({
      sent: false,
      reason: "missing_recipients",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts a bounded request and returns sent on 2xx", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const result = await sendResendMessage(message);
    expect(result).toEqual({ sent: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_key");
    expect(headers["Idempotency-Key"]).toBe("fp-1");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      from: "Alliance HQ <alerts@example.com>",
      to: ["maintainer@example.com"],
      subject: "subject",
      html: "<p>html body</p>",
      text: "text body",
    });
  });

  it.each([400, 403, 422])(
    "returns a non-retryable provider failure for status %i",
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response("{}", { status }),
      );
      const result = await sendResendMessage(message);
      expect(result).toEqual({
        sent: false,
        reason: "provider",
        retryable: false,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([429, 500, 503])(
    "returns a retryable provider failure for status %i",
    async (status) => {
      vi.mocked(fetch).mockResolvedValue(
        new Response("{}", { status }),
      );
      const result = await sendResendMessage(message);
      expect(result).toEqual({
        sent: false,
        reason: "provider",
        retryable: true,
      });
    },
  );

  it("returns a retryable timeout when the abort signal fires", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    );
    const result = await sendResendMessage(message);
    expect(result).toEqual({
      sent: false,
      reason: "timeout",
      retryable: true,
    });
  });

  it("returns a retryable transport failure for fetch errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    const result = await sendResendMessage(message);
    expect(result).toEqual({
      sent: false,
      reason: "transport",
      retryable: true,
    });
  });
});
