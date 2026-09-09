import { createClient, type Base44Client } from "@base44/sdk";

import type { ParsedConnection } from "@/lib/connectionString";

export const KNOWN_ENTITIES = [
  "Violation",
  "ViolationType",
  "Member",
  "Alliance",
  "User",
] as const;

export type KnownEntity = (typeof KNOWN_ENTITIES)[number];

export function createBase44Client(
  connection: ParsedConnection,
): Base44Client {
  return createClient({
    appId: connection.appId,
    token: connection.token,
    appBaseUrl: connection.originUrl,
    headers: {
      "X-Origin-Url": connection.originUrl,
    },
  });
}

export async function verifyBase44Connection(connection: ParsedConnection) {
  const client = createBase44Client(connection);
  const me = await client.auth.me();
  return me as { email?: string; id?: string; full_name?: string };
}
