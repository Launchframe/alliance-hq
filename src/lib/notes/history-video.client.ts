import { CHAT_VIDEO_CONTENT_TYPES } from "@/lib/video/chat-video.shared";

const VIDEO_FINGERPRINT_SLICE_BYTES = 1024 * 1024;

const CHAT_VIDEO_EXTENSION_TYPES: Record<string, (typeof CHAT_VIDEO_CONTENT_TYPES)[number]> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
};

export function normalizeChatVideoFile(file: File): File {
  if ((CHAT_VIDEO_CONTENT_TYPES as readonly string[]).includes(file.type)) return file;
  const extension = /\.[a-z0-9]+$/i.exec(file.name)?.[0]?.toLowerCase();
  const contentType = extension ? CHAT_VIDEO_EXTENSION_TYPES[extension] : undefined;
  if (!contentType) return file;
  return new File([file], file.name, { type: contentType, lastModified: file.lastModified });
}

export async function fingerprintVideoFile(file: File): Promise<string> {
  const metadata = new TextEncoder().encode(JSON.stringify([file.name, file.size, file.type, file.lastModified]));
  const head = await file.slice(0, file.size <= VIDEO_FINGERPRINT_SLICE_BYTES * 2 ? file.size : VIDEO_FINGERPRINT_SLICE_BYTES).arrayBuffer();
  const tail = file.size > VIDEO_FINGERPRINT_SLICE_BYTES * 2
    ? await file.slice(file.size - VIDEO_FINGERPRINT_SLICE_BYTES).arrayBuffer()
    : new ArrayBuffer(0);
  const combined = new Uint8Array(metadata.byteLength + head.byteLength + tail.byteLength);
  combined.set(metadata, 0);
  combined.set(new Uint8Array(head), metadata.byteLength);
  combined.set(new Uint8Array(tail), metadata.byteLength + head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
