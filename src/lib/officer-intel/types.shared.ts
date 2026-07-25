/** Client-safe officer intel types. */

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
};
