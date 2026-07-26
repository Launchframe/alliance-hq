import { notFound } from "next/navigation";

import { OfficerChatSessionClient } from "@/components/officer-intel/OfficerChatSessionClient";
import {
  getOfficerChatSessionForAlliance,
  listOfficerChatMessages,
  listOfficerChatSessionImages,
} from "@/lib/officer-intel/repository.server";
import { OFFICER_INTEL_READ_PERMISSION } from "@/lib/rbac/constants";
import { requirePagePermission } from "@/lib/rbac/page-permission";
import { requirePageSession } from "@/lib/session";
import { isTranslationConfigured } from "@/lib/translate/translate.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function OfficerChatSessionPage({ params }: Props) {
  const { id } = await params;
  const session = await requirePageSession(`/officer-intel/sessions/${id}`);
  await requirePagePermission(session.id, OFFICER_INTEL_READ_PERMISSION);
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) notFound();

  const chatSession = await getOfficerChatSessionForAlliance({
    sessionId: id,
    allianceId,
  });
  if (!chatSession) notFound();

  const [messages, images] = await Promise.all([
    listOfficerChatMessages({ sessionId: id, allianceId }),
    listOfficerChatSessionImages({ sessionId: id, allianceId }),
  ]);

  return (
    <OfficerChatSessionClient
      session={{
        id: chatSession.id,
        title: chatSession.title,
        channelLabel: chatSession.channelLabel,
        sessionAt: chatSession.sessionAt?.toISOString() ?? null,
        status: chatSession.status,
      }}
      messages={messages.map((message) => ({
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
      }))}
      images={images.map((image) => ({
        id: image.id,
        sequenceOrder: image.sequenceOrder,
        href: `/api/officer-intel/sessions/${id}/images/${image.id}`,
      }))}
      translationConfigured={isTranslationConfigured()}
    />
  );
}
