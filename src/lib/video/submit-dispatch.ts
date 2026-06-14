import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44BulkInsert,
  base44EntityPost,
} from "@/lib/base44/fetch";
import type { ScoreTargetDef } from "@/lib/video/score-targets";

export async function dispatchScoreSubmit(
  connection: ParsedConnection,
  target: ScoreTargetDef,
  payloads: Record<string, unknown>[],
): Promise<void> {
  if (payloads.length === 0) {
    return;
  }

  switch (target.submitMethod) {
    case "bulk":
      await base44BulkInsert(connection, target.submitEntity, payloads);
      return;
    case "row-post":
    case "upsert":
      for (const row of payloads) {
        await base44EntityPost(connection, target.submitEntity, row);
      }
      return;
    default:
      throw new Error(`Unsupported submit method: ${target.submitMethod}`);
  }
}
