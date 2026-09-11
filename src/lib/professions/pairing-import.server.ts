import "server-only";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import type { AshedMember } from "@/lib/video/member-matcher";
import {
  isEngApplyable,
  isWlApplyable,
  previewPairingImport,
  type PairingImportCommander,
  type PairingImportPreview,
} from "./pairing-import.shared";
import {
  listActiveEngAssignmentsForAlliance,
  listProfessionImportRoster,
} from "./repository";
import { officerAssignEng, officerSetProfession } from "./service";

const MAX_PASTE_CHARS = 50_000;

export type PairingImportApplyResult = {
  assigned: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function rosterToMembersAndCommanders(
  rows: Awaited<ReturnType<typeof listProfessionImportRoster>>,
): {
  members: AshedMember[];
  commandersByAshedMemberId: Map<string, PairingImportCommander>;
} {
  const members: AshedMember[] = [];
  const commandersByAshedMemberId = new Map<string, PairingImportCommander>();

  for (const row of rows) {
    const profession =
      row.profession === "Engineer" || row.profession === "War Leader"
        ? row.profession
        : null;
    commandersByAshedMemberId.set(row.ashedMemberId, {
      commanderId: row.commanderId,
      profession,
    });
    if (row.memberStatus === "former") continue;
    members.push({
      id: row.ashedMemberId,
      current_name: row.memberName || row.primaryName || row.ashedMemberId,
      previous_names: row.previousNames ?? [],
      status: row.memberStatus ?? "active",
    });
  }

  return { members, commandersByAshedMemberId };
}

async function loadPreviewContext(allianceId: string) {
  const db = getDb();
  const [alliance, roster, assignments] = await Promise.all([
    db
      .select({ tag: schema.alliances.tag })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, allianceId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    listProfessionImportRoster(allianceId),
    listActiveEngAssignmentsForAlliance(allianceId),
  ]);

  const { members, commandersByAshedMemberId } =
    rosterToMembersAndCommanders(roster);
  const activeAssignmentByEngCommanderId = new Map(
    assignments.map((row) => [row.engCommanderId, row.wlCommanderId]),
  );

  return {
    members,
    commandersByAshedMemberId,
    activeAssignmentByEngCommanderId,
    allianceTag: alliance?.tag ?? null,
  };
}

export async function previewProfessionPairingImport(
  allianceId: string,
  text: string,
): Promise<PairingImportPreview> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { lines: [], readyCount: 0, skippedCount: 0, commitCount: 0 };
  }
  if (trimmed.length > MAX_PASTE_CHARS) {
    throw new Error("Paste is too long.");
  }
  const ctx = await loadPreviewContext(allianceId);
  return previewPairingImport({ text: trimmed, ...ctx });
}

export async function applyProfessionPairingImport(
  allianceId: string,
  text: string,
): Promise<PairingImportApplyResult> {
  const preview = await previewProfessionPairingImport(allianceId, text);
  const result: PairingImportApplyResult = {
    assigned: 0,
    skipped: preview.skippedCount,
    failed: 0,
    errors: [],
  };

  for (const line of preview.lines) {
    if (!isWlApplyable(line.wl.status) || !line.wl.commanderId) continue;
    const wlCommanderId = line.wl.commanderId;

    if (line.wl.status === "will_set_profession") {
      try {
        await officerSetProfession({
          allianceId,
          commanderId: wlCommanderId,
          toProfession: "War Leader",
        });
      } catch (error) {
        result.failed += line.engineers.filter((eng) =>
          isEngApplyable(eng.status),
        ).length;
        result.errors.push(
          error instanceof Error ? error.message : "Could not set War Leader.",
        );
        continue;
      }
    }

    for (const eng of line.engineers) {
      if (!isEngApplyable(eng.status) || !eng.commanderId) continue;
      try {
        if (eng.status === "will_set_profession") {
          await officerSetProfession({
            allianceId,
            commanderId: eng.commanderId,
            toProfession: "Engineer",
          });
        }
        await officerAssignEng({
          allianceId,
          engCommanderId: eng.commanderId,
          wlCommanderId,
          suppressNotifications: true,
        });
        result.assigned += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push(
          error instanceof Error ? error.message : "Assignment failed.",
        );
      }
    }
  }

  return result;
}
