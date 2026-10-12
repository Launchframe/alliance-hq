import { z } from "zod";

export const COMMANDER_TRANSFER_ERROR_CODES = [
  "commander_not_linked",
  "commander_missing_uid",
  "destination_server_unknown",
  "destination_member_not_found",
  "destination_member_claimed",
  "destination_commander_has_uid",
  "user_already_linked",
] as const;

export type CommanderTransferErrorCode =
  (typeof COMMANDER_TRANSFER_ERROR_CODES)[number];

export type CommanderTransferSummary = {
  fromServer: number | null;
  toServer: number;
  allianceName: string;
  memberName: string;
  historyCount: number;
};

export const commanderTransferRequestSchema = z.object({
  hqUserId: z.string().min(1),
  commanderId: z.string().min(1),
  destinationAllianceId: z.string().min(1),
  destinationAshedMemberId: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export function isCommanderTransferErrorCode(
  value: unknown,
): value is CommanderTransferErrorCode {
  return (
    typeof value === "string" &&
    (COMMANDER_TRANSFER_ERROR_CODES as readonly string[]).includes(value)
  );
}
