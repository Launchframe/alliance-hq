import "server-only";

import {
  base44EntityPost,
  base44EntityPut,
} from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";

/** Status written to Ashed when a member leaves; inbound sync copies this into HQ. */
export const ASHED_MEMBER_FORMER_STATUS = "former";

export async function createAshedMember(input: {
  connection: ParsedConnection;
  ashedAllianceId: string;
  currentName: string;
}): Promise<string> {
  const created = (await base44EntityPost(input.connection, "Member", {
    alliance_id: input.ashedAllianceId,
    current_name: input.currentName,
    status: "active",
    previous_names: [],
  })) as { id?: string };
  const id = created.id?.trim();
  if (!id) {
    throw new Error("Ashed did not return a member id.");
  }
  return id;
}

export async function setAshedMemberStatus(input: {
  connection: ParsedConnection;
  ashedMemberId: string;
  status: string;
}): Promise<void> {
  await base44EntityPut(input.connection, "Member", input.ashedMemberId, {
    status: input.status,
  });
}

export async function markAshedMemberFormer(input: {
  connection: ParsedConnection;
  ashedMemberId: string;
}): Promise<void> {
  await setAshedMemberStatus({
    connection: input.connection,
    ashedMemberId: input.ashedMemberId,
    status: ASHED_MEMBER_FORMER_STATUS,
  });
}
