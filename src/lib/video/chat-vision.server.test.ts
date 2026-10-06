import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  knowledgeTestProviderEnabled: vi.fn(),
  isOfficerIntelLlmConfigured: vi.fn(),
  officerIntelLlmModel: vi.fn(),
  generateObject: vi.fn(),
  createOpenAI: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/officer-intel/embed-corpus.server", () => ({
  knowledgeTestProviderEnabled: mocks.knowledgeTestProviderEnabled,
}));
vi.mock("@/lib/officer-intel/llm-config.server", () => ({
  isOfficerIntelLlmConfigured: mocks.isOfficerIntelLlmConfigured,
  officerIntelLlmModel: mocks.officerIntelLlmModel,
}));
vi.mock("ai", () => ({ generateObject: mocks.generateObject }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: mocks.createOpenAI }));

import {
  CHAT_PARSER_NOT_CONFIGURED,
  chatParserProvenance,
  resolveChatFrameParser,
} from "./chat-vision.server";

const png = Buffer.from("png-bytes");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.knowledgeTestProviderEnabled.mockReturnValue(false);
  mocks.isOfficerIntelLlmConfigured.mockReturnValue(false);
  mocks.officerIntelLlmModel.mockReturnValue(null);
});

describe("resolveChatFrameParser", () => {
  it("throws chat_parser_not_configured when no provider is configured", () => {
    expect(() => resolveChatFrameParser()).toThrow(CHAT_PARSER_NOT_CONFIGURED);
  });

  it("uses the fenced deterministic provider in test mode", async () => {
    mocks.knowledgeTestProviderEnabled.mockReturnValue(true);
    const { parse, model } = resolveChatFrameParser();
    expect(model).toBe("e2e-chat-video-v1");
    const output = await parse({ png, frameIndex: 3, frameHash: "h" });
    expect(output.messages).toHaveLength(1);
    expect(output.messages[0]!.localId).toBe("f3-m0");
    expect(mocks.generateObject).not.toHaveBeenCalled();
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("sends the PNG as an image part with strict bounds to generateObject", async () => {
    mocks.isOfficerIntelLlmConfigured.mockReturnValue(true);
    mocks.officerIntelLlmModel.mockReturnValue("gpt-4o-mini");
    const modelFn = vi.fn().mockReturnValue("model-handle");
    mocks.createOpenAI.mockReturnValue(modelFn);
    mocks.generateObject.mockResolvedValue({
      object: {
        messages: [
          {
            localId: "m0", sender: "Officer", originalText: "hi", detectedLanguage: "en",
            confidence: 0.9, box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 },
            isReply: false, replyToName: null, replyExcerpt: null, coordinates: null,
          },
        ],
        media: [],
      },
    });
    const { parse, model } = resolveChatFrameParser();
    expect(model).toBe("gpt-4o-mini");
    const output = await parse({ png, frameIndex: 0, frameHash: "h" });
    expect(output.messages[0]!.originalText).toBe("hi");
    const call = mocks.generateObject.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.maxOutputTokens).toBe(6000);
    expect(call.maxRetries).toBe(1);
    const content = (call.messages as Array<{ content: Array<Record<string, unknown>> }>)[0]!.content;
    const image = content.find((part) => part.type === "image");
    expect(image).toEqual(expect.objectContaining({ image: png, mediaType: "image/png" }));
  });

  it("rejects provider output that violates the strict schema", async () => {
    mocks.isOfficerIntelLlmConfigured.mockReturnValue(true);
    mocks.officerIntelLlmModel.mockReturnValue("gpt-4o-mini");
    mocks.createOpenAI.mockReturnValue(vi.fn().mockReturnValue("model-handle"));
    mocks.generateObject.mockResolvedValue({
      object: {
        messages: [
          {
            localId: "m0", sender: "Officer", originalText: "hi", detectedLanguage: "en",
            confidence: 0.9, box: { x: 0.9, y: 0.1, width: 0.5, height: 0.1 },
            isReply: false, replyToName: null, replyExcerpt: null, coordinates: null,
          },
        ],
        media: [],
      },
    });
    const { parse } = resolveChatFrameParser();
    await expect(parse({ png, frameIndex: 0, frameHash: "h" })).rejects.toThrow();
  });
});

describe("chatParserProvenance", () => {
  it("stamps the openai provider, model, config version, and frame hash", () => {
    expect(chatParserProvenance("gpt-4o-mini", "abc")).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
      configVersion: "chat-video-v1",
      frameHash: "abc",
    });
  });
});
