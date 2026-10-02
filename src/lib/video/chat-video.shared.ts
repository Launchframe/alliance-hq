import type { ExtractionConfig } from "@/lib/video/pass-definitions";

export const OFFICER_CHAT_VIDEO_TARGET = "officer-chat-video" as const;

export const CHAT_VIDEO_MAX_DURATION_SECONDS = 120;

export const CHAT_VIDEO_EXTRACTION_CONFIG = {
  mode: "scene",
  sceneThreshold: 0.08,
  sampleFps: 2,
  supplementFps: 2,
} as const satisfies ExtractionConfig;

export const CHAT_VIDEO_MAX_SELECTED_FRAMES = 240;

export const CHAT_VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export function isOfficerChatVideoTarget(
  scoreTarget: string | null | undefined,
): boolean {
  return scoreTarget === OFFICER_CHAT_VIDEO_TARGET;
}

export function isChatVideoSignature(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (bytes.length < 8) return false;
  if (contentType === "video/webm") {
    return (
      bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
    );
  }
  return (
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
  );
}
