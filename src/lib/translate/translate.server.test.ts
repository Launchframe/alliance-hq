import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRANSLATION_INPUT_MAX_CHARS,
  isTranslationConfigured,
  translateText,
} from "@/lib/translate/translate.server";

const ORIGINAL_KEY = process.env.GOOGLE_TRANSLATE_API_KEY;

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.GOOGLE_TRANSLATE_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY == null) {
    delete process.env.GOOGLE_TRANSLATE_API_KEY;
  } else {
    process.env.GOOGLE_TRANSLATE_API_KEY = ORIGINAL_KEY;
  }
});

describe("isTranslationConfigured", () => {
  it("reflects GOOGLE_TRANSLATE_API_KEY presence", () => {
    expect(isTranslationConfigured()).toBe(true);
    process.env.GOOGLE_TRANSLATE_API_KEY = "  ";
    expect(isTranslationConfigured()).toBe(false);
  });
});

describe("translateText", () => {
  it("POSTs the text and parses translation + detected source", async () => {
    const fetchMock = mockFetchOnce(200, {
      data: {
        translations: [
          { translatedText: "Olá, mundo", detectedSourceLanguage: "en" },
        ],
      },
    });

    const result = await translateText({ text: "Hello, world", targetLanguage: "pt" });

    expect(result).toEqual({
      translatedText: "Olá, mundo",
      detectedSourceLanguage: "en",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("translation.googleapis.com");
    expect(String(url)).toContain("key=test-key");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      q: "Hello, world",
      target: "pt",
      format: "text",
    });
  });

  it("returns null detected source when the provider omits it", async () => {
    mockFetchOnce(200, {
      data: { translations: [{ translatedText: "Bonjour" }] },
    });
    const result = await translateText({ text: "Hello", targetLanguage: "fr" });
    expect(result.detectedSourceLanguage).toBeNull();
  });

  it("surfaces provider error messages", async () => {
    mockFetchOnce(403, { error: { message: "API key invalid" } });
    await expect(
      translateText({ text: "Hello", targetLanguage: "pt" }),
    ).rejects.toThrow("API key invalid");
  });

  it("throws a status-based error when the error body is unreadable", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("not json", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      translateText({ text: "Hello", targetLanguage: "pt" }),
    ).rejects.toThrow("status 500");
  });

  it("rejects oversized input before calling the provider", async () => {
    const fetchMock = mockFetchOnce(200, {});
    await expect(
      translateText({
        text: "a".repeat(TRANSLATION_INPUT_MAX_CHARS + 1),
        targetLanguage: "pt",
      }),
    ).rejects.toThrow("exceeds");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the API key is missing", async () => {
    delete process.env.GOOGLE_TRANSLATE_API_KEY;
    await expect(
      translateText({ text: "Hello", targetLanguage: "pt" }),
    ).rejects.toThrow("GOOGLE_TRANSLATE_API_KEY");
  });
});
