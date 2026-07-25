/**
 * POST /api/officer-intel/sessions/[id]/import
 *
 * Commit reviewed messages and retain screenshots in R2.
 */

import { getLocale } from "next-intl/server";
import { NextResponse } from "next/server";

import { importOfficerChatSession } from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelWrite,
} from "@/lib/officer-intel/route-helpers.server";
import type { OfficerChatImportMessageInput } from "@/lib/officer-intel/types.shared";
import {
  isAllowedOfficerIntelImageMime,
  MAX_OFFICER_INTEL_IMAGE_BYTES,
  MAX_OFFICER_INTEL_IMAGES,
} from "@/lib/officer-intel/storage.shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Props = { params: Promise<{ id: string }> };

function collectImageFiles(formData: FormData): File[] {
  const files: File[] = [];
  for (const [key, value] of formData.entries()) {
    if (key !== "image" && key !== "images") continue;
    if (value instanceof File && value.size > 0) {
      files.push(value);
    }
  }
  return files;
}

function parseMessagesField(raw: unknown): OfficerChatImportMessageInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const messages: OfficerChatImportMessageInput[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const record = row as Record<string, unknown>;
    if (typeof record.senderName !== "string" || typeof record.originalText !== "string") {
      return null;
    }
    if (
      typeof record.sequenceOrder !== "number" ||
      typeof record.sourceImageIndex !== "number"
    ) {
      return null;
    }
    messages.push({
      senderAllianceTag:
        typeof record.senderAllianceTag === "string"
          ? record.senderAllianceTag
          : null,
      senderName: record.senderName,
      senderLevel:
        typeof record.senderLevel === "number" ? record.senderLevel : null,
      senderVipLevel:
        typeof record.senderVipLevel === "number" ? record.senderVipLevel : null,
      originalText: record.originalText,
      inGameTranslatedText:
        typeof record.inGameTranslatedText === "string"
          ? record.inGameTranslatedText
          : null,
      isReply: record.isReply === true,
      replyToName:
        typeof record.replyToName === "string" ? record.replyToName : null,
      sequenceOrder: record.sequenceOrder,
      sourceImageIndex: record.sourceImageIndex,
    });
  }
  return messages;
}

export async function POST(request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelWrite(context.sessionId);
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 },
    );
  }

  const payloadRaw = formData.get("payload");
  if (typeof payloadRaw !== "string") {
    return NextResponse.json({ error: "payload field is required." }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "payload must be valid JSON." }, { status: 400 });
  }

  const messages = parseMessagesField(payload.messages);
  if (!messages) {
    return NextResponse.json(
      { error: "messages must be a non-empty array." },
      { status: 400 },
    );
  }

  const imageFiles = collectImageFiles(formData);
  if (imageFiles.length === 0) {
    return NextResponse.json(
      { error: "At least one screenshot image is required." },
      { status: 400 },
    );
  }
  if (imageFiles.length > MAX_OFFICER_INTEL_IMAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_OFFICER_INTEL_IMAGES} screenshots per import.` },
      { status: 400 },
    );
  }

  const images: Array<{
    buffer: Buffer;
    mimeType: string;
    width: number | null;
    height: number | null;
  }> = [];

  for (const imageFile of imageFiles) {
    if (imageFile.size > MAX_OFFICER_INTEL_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image must be under 20 MB." },
        { status: 413 },
      );
    }
    if (!isAllowedOfficerIntelImageMime(imageFile.type)) {
      return NextResponse.json(
        { error: "Invalid screenshot type." },
        { status: 400 },
      );
    }
    images.push({
      buffer: Buffer.from(await imageFile.arrayBuffer()),
      mimeType: imageFile.type,
      width: null,
      height: null,
    });
  }

  const sessionAt =
    typeof payload.sessionAt === "string" && payload.sessionAt.trim().length > 0
      ? new Date(payload.sessionAt)
      : null;
  if (sessionAt && Number.isNaN(sessionAt.getTime())) {
    return NextResponse.json({ error: "Invalid sessionAt." }, { status: 400 });
  }

  const locale = await getLocale();
  const result = await importOfficerChatSession({
    sessionId: id,
    allianceId: context.allianceId,
    hqLocale: locale,
    title: typeof payload.title === "string" ? payload.title : undefined,
    channelLabel:
      typeof payload.channelLabel === "string" ? payload.channelLabel : null,
    sessionAt,
    messages,
    images,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json({ ok: true, sessionId: id });
}
