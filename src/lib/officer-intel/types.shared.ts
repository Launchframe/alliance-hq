/** Client-safe officer intel types. */

import { redactIntakeText } from "@/lib/notes/intake.shared";

export function redactOfficerChatMessage<T extends ParsedOfficerChatMessage>(message: T): T {
  return {
    ...message,
    senderName: redactIntakeText(message.senderName),
    senderAllianceTag: message.senderAllianceTag === null ? null : redactIntakeText(message.senderAllianceTag),
    originalText: redactIntakeText(message.originalText),
    inGameTranslatedText: message.inGameTranslatedText === null ? null : redactIntakeText(message.inGameTranslatedText),
    replyToName: message.replyToName === null ? null : redactIntakeText(message.replyToName),
    ...("localeText" in message && typeof message.localeText === "string" ? { localeText: redactIntakeText(message.localeText) } : {}),
  };
}

export type OfficerChatSessionStatus = "draft" | "imported";

export type ParsedOfficerChatMessage = {
  senderAllianceTag: string | null;
  senderName: string;
  senderLevel: number | null;
  senderVipLevel: number | null;
  originalText: string;
  inGameTranslatedText: string | null;
  isReply: boolean;
  replyToName: string | null;
  sequenceOrder: number;
  sourceImageIndex: number;
};

export type OfficerChatImportMessageInput = {
  senderAllianceTag?: string | null;
  senderName: string;
  senderLevel?: number | null;
  senderVipLevel?: number | null;
  originalText: string;
  inGameTranslatedText?: string | null;
  isReply?: boolean;
  replyToName?: string | null;
  sequenceOrder: number;
  sourceImageIndex: number;
};

export type OfficerChatSessionSummary = {
  id: string;
  title: string;
  channelLabel: string | null;
  sessionAt: string | null;
  status: OfficerChatSessionStatus;
  messageCount: number;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

export type OfficerChatMessageRecord = {
  id: string;
  senderAllianceTag: string | null;
  senderName: string;
  senderLevel: number | null;
  senderVipLevel: number | null;
  originalText: string;
  inGameTranslatedText: string | null;
  localeText: string;
  localeCode: string;
  isReply: boolean;
  replyToName: string | null;
  sequenceOrder: number;
  sourceImageIndex: number;
};

export type OfficerIntelDashboardPayload = {
  sessions: OfficerChatSessionSummary[];
  canWrite: boolean;
  translationConfigured: boolean;
  llmConfigured: boolean;
  openActionItemCount: number;
  approvedNoteCount: number;
};
