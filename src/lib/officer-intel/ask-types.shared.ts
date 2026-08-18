/** Client-safe Q&A stream types for Officer Intelligence. */

export type OfficerIntelAskSourceType = "approved_note" | "action_item";

export type OfficerIntelAskCitation = {
  sourceType: OfficerIntelAskSourceType;
  sourceId: string;
  sessionId: string | null;
  sessionTitle: string | null;
  channelLabel: string | null;
  sessionAt: string | null;
  href: string;
};

export type OfficerIntelAskEvent =
  | {
      type: "meta";
      threadId: string;
      citations: OfficerIntelAskCitation[];
    }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; threadId: string };

export type OfficerIntelAskRequest = {
  question: string;
  threadId?: string | null;
};
