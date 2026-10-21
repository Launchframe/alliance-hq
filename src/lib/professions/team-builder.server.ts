import "server-only";

import {
  listActiveEngAssignmentsForAlliance,
  listProfessionImportRoster,
} from "@/lib/professions/repository";
import {
  dismissEng,
  officerAssignEng,
  officerSetProfession,
} from "@/lib/professions/service";
import {
  teamBuilderDisplayName,
  type TeamBuilderPerson,
} from "@/lib/professions/team-builder.shared";

export type TeamBuilderRosterMember = TeamBuilderPerson & {
  profession: "Engineer" | "War Leader" | null;
};

function asProfession(
  value: string | null,
): "Engineer" | "War Leader" | null {
  if (value === "Engineer" || value === "War Leader") return value;
  return null;
}

export async function loadProfessionTeamBuilderRoster(
  allianceId: string,
): Promise<TeamBuilderRosterMember[]> {
  const rows = await listProfessionImportRoster(allianceId);
  return rows.map((row) => {
    const name = teamBuilderDisplayName({
      memberName: row.memberName,
      primaryName: row.primaryName,
    });
    return {
      commanderId: row.commanderId,
      name: name || row.commanderId,
      rank:
        row.allianceRank === 1 ||
        row.allianceRank === 2 ||
        row.allianceRank === 3 ||
        row.allianceRank === 4 ||
        row.allianceRank === 5
          ? row.allianceRank
          : null,
      profession: asProfession(row.profession),
    };
  });
}

export async function applyProfessionTeamBuilder(
  allianceId: string,
  input: {
    professionFills: { commanderId: string; profession: "Engineer" | "War Leader" }[];
    assignments: { engCommanderId: string; wlCommanderId: string | null }[];
  },
): Promise<{ assigned: number; moved: number }> {
  const roster = await listProfessionImportRoster(allianceId);
  const byId = new Map(roster.map((row) => [row.commanderId, { ...row }]));

  for (const fill of input.professionFills) {
    if (fill.profession !== "Engineer" && fill.profession !== "War Leader") {
      throw new Error("Invalid profession.");
    }
    const row = byId.get(fill.commanderId);
    if (!row) throw new Error("Commander is not a member of this alliance.");
    const current = asProfession(row.profession);
    if (current === fill.profession) continue;
    if (current) throw new Error("Profession is already set.");
    await officerSetProfession({
      allianceId,
      commanderId: fill.commanderId,
      toProfession: fill.profession,
    });
    row.profession = fill.profession;
  }

  const currentAssignments = await listActiveEngAssignmentsForAlliance(allianceId);
  const currentWl = new Map(
    currentAssignments.map((row) => [row.engCommanderId, row.wlCommanderId]),
  );
  const desired = new Map<string, string | null>();
  for (const row of input.assignments) {
    desired.set(row.engCommanderId, row.wlCommanderId);
  }
  for (const engCommanderId of currentWl.keys()) {
    if (!desired.has(engCommanderId)) desired.set(engCommanderId, null);
  }

  let assigned = 0;
  let moved = 0;
  for (const [engCommanderId, wlCommanderId] of desired) {
    const engineer = byId.get(engCommanderId);
    const profession = engineer ? asProfession(engineer.profession) : null;
    if (profession !== "Engineer") {
      if (wlCommanderId) {
        throw new Error("Only Engineers can be assigned to a War Leader.");
      }
      continue;
    }
    const fromWl = currentWl.get(engCommanderId) ?? null;
    if (fromWl === wlCommanderId) continue;
    moved += 1;
    if (fromWl) {
      await dismissEng({
        allianceId,
        wlCommanderId: fromWl,
        engCommanderId,
        suppressNotifications: true,
      });
    }
    if (wlCommanderId) {
      const warLeader = byId.get(wlCommanderId);
      if (!warLeader || asProfession(warLeader.profession) !== "War Leader") {
        throw new Error("War Leader was not found.");
      }
      await officerAssignEng({
        allianceId,
        engCommanderId,
        wlCommanderId,
        suppressNotifications: true,
      });
      assigned += 1;
    }
  }

  return { assigned, moved };
}
