import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { withConductorPoolClaimLock } from "@/lib/trains/conductor-pool-claim-lock.server";
import {
  assessPoolGenerationMerge,
  type PoolGenerationMergeAssessment,
} from "@/lib/trains/pool-generation-merge.shared";
import {
  getCurrentPoolGeneration,
  getPoolSummary,
} from "@/lib/trains/pool";
import {
  clearConductorAssignment,
  clearVipAssignment,
  getConductorRecord,
} from "@/lib/trains/repository";
import type { PoolType } from "@/lib/trains/types";

export class PoolGenerationMergeError extends Error {
  readonly code:
    | "NO_PRIOR"
    | "NOT_ADJACENT"
    | "SELECTED_OVERLAP"
    | "LOCKED_DRAFT";

  constructor(
    code: PoolGenerationMergeError["code"],
    message: string,
  ) {
    super(message);
    this.name = "PoolGenerationMergeError";
    this.code = code;
  }
}

type GenerationSelection = {
  memberId: string;
  selectedForDate: string;
};

async function loadGenerationSelections(
  allianceId: string,
  poolType: PoolType,
  generation: number,
): Promise<GenerationSelection[]> {
  const db = getDb();
  const rows = await db
    .select({
      memberId: schema.conductorPoolEntries.memberId,
      selectedForDate: schema.conductorPoolEntries.selectedForDate,
      selectedAt: schema.conductorPoolEntries.selectedAt,
    })
    .from(schema.conductorPoolEntries)
    .where(
      and(
        eq(schema.conductorPoolEntries.allianceId, allianceId),
        eq(schema.conductorPoolEntries.poolType, poolType),
        eq(schema.conductorPoolEntries.generation, generation),
      ),
    );

  return rows.flatMap((row) => {
    if (!row.selectedAt || !row.selectedForDate) return [];
    return [
      {
        memberId: row.memberId,
        selectedForDate: row.selectedForDate,
      },
    ];
  });
}

export async function assessRestorePreviousPoolGeneration(input: {
  allianceId: string;
  poolType: PoolType;
}): Promise<
  PoolGenerationMergeAssessment & {
    lockedDraftDates: string[];
  }
> {
  const currentGeneration = await getCurrentPoolGeneration(
    input.allianceId,
    input.poolType,
  );
  const priorGeneration =
    currentGeneration > 1 ? currentGeneration - 1 : null;

  const [priorSelections, currentSelections] = await Promise.all([
    priorGeneration != null
      ? loadGenerationSelections(
          input.allianceId,
          input.poolType,
          priorGeneration,
        )
      : Promise.resolve([]),
    loadGenerationSelections(
      input.allianceId,
      input.poolType,
      currentGeneration,
    ),
  ]);

  const assessment = assessPoolGenerationMerge({
    currentGeneration,
    priorGeneration,
    priorSelectedMemberIds: priorSelections.map((row) => row.memberId),
    currentSelectedMemberIds: currentSelections.map((row) => row.memberId),
  });

  const lockedDraftDates: string[] = [];
  if (assessment.available && currentSelections.length > 0) {
    const db = getDb();
    const dates = [...new Set(currentSelections.map((row) => row.selectedForDate))];
    if (dates.length > 0) {
      const records = await db
        .select({
          date: schema.trainConductorRecords.date,
          lockedAt: schema.trainConductorRecords.lockedAt,
          conductorMemberId: schema.trainConductorRecords.conductorMemberId,
          vipMemberId: schema.trainConductorRecords.vipMemberId,
        })
        .from(schema.trainConductorRecords)
        .where(
          and(
            eq(schema.trainConductorRecords.allianceId, input.allianceId),
            inArray(schema.trainConductorRecords.date, dates),
          ),
        );
      const selectedByDate = new Map(
        currentSelections.map((row) => [row.selectedForDate, row.memberId]),
      );
      const vipPool = input.poolType === "event_top_x";
      for (const record of records) {
        const expectedMemberId = selectedByDate.get(record.date);
        if (!expectedMemberId || !record.lockedAt) continue;
        const matches = vipPool
          ? record.vipMemberId === expectedMemberId
          : record.conductorMemberId === expectedMemberId;
        if (matches) {
          lockedDraftDates.push(record.date);
        }
      }
    }
  }

  return { ...assessment, lockedDraftDates };
}

/**
 * Delete the current pool generation and return to the immediate prior one.
 * Discards unlocked conductor drafts tied to current-generation selections.
 * Refuses when selected members overlap prior selections, or when any
 * current-generation selection is still locked on a day record.
 */
export async function restorePreviousPoolGeneration(input: {
  allianceId: string;
  poolType: PoolType;
}): Promise<{
  generation: number;
  discardedDraftDates: string[];
  summary: Awaited<ReturnType<typeof getPoolSummary>>;
}> {
  return withConductorPoolClaimLock(
    { allianceId: input.allianceId, poolType: input.poolType },
    async () => {
      const assessment = await assessRestorePreviousPoolGeneration(input);
      if (!assessment.available) {
        if (assessment.blockReason === "selected_overlap") {
          throw new PoolGenerationMergeError(
            "SELECTED_OVERLAP",
            "Cannot restore the previous generation — a member picked earlier was also picked in the current generation.",
          );
        }
        if (assessment.blockReason === "not_adjacent") {
          throw new PoolGenerationMergeError(
            "NOT_ADJACENT",
            "Cannot restore — only the immediate previous generation can be restored.",
          );
        }
        throw new PoolGenerationMergeError(
          "NO_PRIOR",
          "There is no previous generation to restore.",
        );
      }

      if (assessment.lockedDraftDates.length > 0) {
        throw new PoolGenerationMergeError(
          "LOCKED_DRAFT",
          `Unlock and discard locked conductors first (${assessment.lockedDraftDates
            .slice()
            .sort()
            .join(", ")}).`,
        );
      }

      const currentGeneration = assessment.currentGeneration;
      const priorGeneration = assessment.priorGeneration!;
      const currentSelections = await loadGenerationSelections(
        input.allianceId,
        input.poolType,
        currentGeneration,
      );

      const discardedDraftDates: string[] = [];
      const vipPool = input.poolType === "event_top_x";
      for (const selection of currentSelections) {
        const record = await getConductorRecord(
          input.allianceId,
          selection.selectedForDate,
        );
        if (record?.lockedAt) {
          const matches = vipPool
            ? record.vipMemberId === selection.memberId
            : record.conductorMemberId === selection.memberId;
          if (matches) {
            throw new PoolGenerationMergeError(
              "LOCKED_DRAFT",
              `Unlock and discard locked conductors first (${selection.selectedForDate}).`,
            );
          }
        }
        if (vipPool) {
          if (record?.vipMemberId === selection.memberId) {
            await clearVipAssignment(
              input.allianceId,
              selection.selectedForDate,
            );
            discardedDraftDates.push(selection.selectedForDate);
          }
          continue;
        }
        if (record?.conductorMemberId !== selection.memberId) {
          // Pool mark without matching day draft — still drop the generation row.
          continue;
        }
        await clearConductorAssignment(
          input.allianceId,
          selection.selectedForDate,
          undefined,
          { releasePool: false },
        );
        discardedDraftDates.push(selection.selectedForDate);
      }

      const db = getDb();
      await db
        .delete(schema.conductorPoolEntries)
        .where(
          and(
            eq(schema.conductorPoolEntries.allianceId, input.allianceId),
            eq(schema.conductorPoolEntries.poolType, input.poolType),
            eq(schema.conductorPoolEntries.generation, currentGeneration),
          ),
        );

      const summary = await getPoolSummary(input.allianceId, input.poolType);
      if (summary.generation !== priorGeneration) {
        // Defensive: max(generation) should now be the prior gen.
        throw new Error(
          `Expected generation ${priorGeneration} after restore, found ${summary.generation}.`,
        );
      }

      return {
        generation: priorGeneration,
        discardedDraftDates,
        summary,
      };
    },
  );
}
