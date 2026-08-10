/**
 * GET /api/officer-intel/sessions/[id]
 */

import { NextResponse } from "next/server";

import {
  getOfficerChatSessionForAlliance,
  listOfficerChatMessages,
  listOfficerChatSessionImages,
} from "@/lib/officer-intel/repository.server";
import {
  requireOfficerIntelAllianceContext,
  requireOfficerIntelRead,
} from "@/lib/officer-intel/route-helpers.server";
import { isTranslationConfigured } from "@/lib/translate/translate.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Props) {
  const { id } = await params;
  const context = await requireOfficerIntelAllianceContext();
  if ("error" in context && context.error) return context.error;

  const denied = await requireOfficerIntelRead(context.sessionId);
  if (denied) return denied;

  const session = await getOfficerChatSessionForAlliance({
    sessionId: id,
    allianceId: context.allianceId,
  });
  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const [messages, images] = await Promise.all([
    listOfficerChatMessages({
      sessionId: id,
      allianceId: context.allianceId,
    }),
    listOfficerChatSessionImages({
      sessionId: id,
      allianceId: context.allianceId,
    }),
  ]);

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      channelLabel: session.channelLabel,
      sessionAt: session.sessionAt?.toISOString() ?? null,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    },
    messages: messages.map((message) => ({
      id: message.id,
      senderAllianceTag: message.senderAllianceTag,
      senderName: message.senderName,
      senderLevel: message.senderLevel,
      senderVipLevel: message.senderVipLevel,
      originalText: message.originalText,
      inGameTranslatedText: message.inGameTranslatedText,
      localeText: message.localeText,
      localeCode: message.localeCode,
      isReply: message.isReply,
      replyToName: message.replyToName,
      sequenceOrder: message.sequenceOrder,
      sourceImageIndex: message.sourceImageIndex,
    })),
    images: images.map((image) => ({
      id: image.id,
      sequenceOrder: image.sequenceOrder,
      width: image.width,
      height: image.height,
      href: `/api/officer-intel/sessions/${id}/images/${image.id}`,
    })),
    translationConfigured: isTranslationConfigured(),
  });
}
