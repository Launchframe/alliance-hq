import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { AuditLogEntry } from "@/lib/db/schema";
import type { OfficerAuditSeverity } from "@/lib/bff/officer-action-audit.shared";

export async function writeAuditLog(
  entry: Omit<AuditLogEntry, "id" | "createdAt"> & {
    severity?: OfficerAuditSeverity;
  },
) {
  const db = getDb();
  await db.insert(schema.auditLog).values({
    ...entry,
    id: nanoid(16),
    createdAt: new Date(),
    severity: entry.severity ?? "update",
  });
}
