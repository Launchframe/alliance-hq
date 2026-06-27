import "server-only";

import { base44Json } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";

export async function syncMemberNameToAshed(
  connection: ParsedConnection,
  ashedMemberId: string,
  currentName: string,
): Promise<void> {
  const name = currentName.trim();
  if (!name) return;

  await base44Json(connection, `/entities/Member/${ashedMemberId}`, {
    method: "PUT",
    body: JSON.stringify({ current_name: name }),
  });
}
