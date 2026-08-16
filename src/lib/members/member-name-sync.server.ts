import "server-only";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";

export async function syncMemberNameToAshed(
  connection: ParsedConnection,
  ashedMemberId: string,
  currentName: string,
  previousNames?: string[],
): Promise<void> {
  const name = currentName.trim();
  if (!name) return;

  const body: { current_name: string; previous_names?: string[] } = {
    current_name: name,
  };
  if (previousNames) {
    body.previous_names = previousNames;
  }

  await base44Json(connection, `/entities/Member/${ashedMemberId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
