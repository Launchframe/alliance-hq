declare module "@/lib/officer-intel/ask.server" {
  export function streamOfficerIntelAsk(input: {
    allianceId: string;
    hqUserId: string | null;
    sessionId: string;
    question: string;
    threadId?: string | null;
  }): Promise<Response>;
}
