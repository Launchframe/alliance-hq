/**
 * POST /api/officer-intel/sessions/[id]/parse
 *
 * Multipart still-image OCR for in-game officer chat screenshots.
 * Returns a review payload; does not write messages or images to storage.
 */

import { NextResponse } from "next/server";

import {
  mergeOfficerChatImageParses,
  parseOfficerChatImage,
} from "@/lib/officer-intel/chat-ocr/parse-chat-image.server";
import { getOfficerChatSessionForAlliance } from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelWrite,
} from "@/lib/officer-intel/route-helpers.server";
import {
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

export async function POST(request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelWrite(context.sessionId);
  if (denied) return denied;

  const session = await getOfficerChatSessionForAlliance({
    sessionId: id,
    allianceId: context.allianceId,
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 },
    );
  }

  const imageFiles = collectImageFiles(formData);
  if (imageFiles.length === 0) {
    return NextResponse.json(
      { error: "image field is required (File)." },
      { status: 400 },
    );
  }
  if (imageFiles.length > MAX_OFFICER_INTEL_IMAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_OFFICER_INTEL_IMAGES} screenshots per import.` },
      { status: 400 },
    );
  }
  for (const imageFile of imageFiles) {
    if (imageFile.size > MAX_OFFICER_INTEL_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Image must be under 20 MB." },
        { status: 413 },
      );
    }
  }

  try {
    const parts = [];
    let sequenceOffset = 0;
    for (let index = 0; index < imageFiles.length; index += 1) {
      const imageBuffer = Buffer.from(await imageFiles[index]!.arrayBuffer());
      const parsed = await parseOfficerChatImage(
        imageBuffer,
        index,
        sequenceOffset,
      );
      sequenceOffset += parsed.messages.length;
      parts.push(parsed);
    }

    const { messages, rawLinesByImage } = mergeOfficerChatImageParses(parts);

    return NextResponse.json({
      messages,
      imageCount: imageFiles.length,
      rawLinesByImage,
    });
  } catch (error) {
    console.error("officer-intel parse failed", error);
    return NextResponse.json(
      { error: "Failed to parse chat screenshots." },
      { status: 500 },
    );
  }
}
