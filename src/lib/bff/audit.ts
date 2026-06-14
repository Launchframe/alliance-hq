import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { AuditLogEntry } from "@/lib/db/schema";

export async function writeAuditLog(
  entry: Omit<AuditLogEntry, "id" | "createdAt">,
) {
  const db = getDb();
  await db.insert(schema.auditLog).values({
    id: nanoid(16),
    createdAt: new Date(),
    ...entry,
  });
}
