"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import type { CommanderIdentityConflict } from "@/lib/members/commander-identity-conflicts.shared";
import {
  detectBatchNameConflicts,
  normalizeCommanderName,
} from "@/lib/members/commander-identity-conflicts.shared";
import type { AshedMember } from "@/lib/video/member-matcher";

type ConflictRow = {
  ashedMemberId: string;
  currentName: string;
  existingMemberName?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: CommanderIdentityConflict[];
  members: AshedMember[];
  gameServerNumber?: number | null;
  onResolved: () => void;
};

function conflictRowsFromPayload(
  conflicts: CommanderIdentityConflict[],
  members: AshedMember[],
): ConflictRow[] {
  const byMember = new Map<string, CommanderIdentityConflict>();
  for (const conflict of conflicts) {
    if (conflict.ashedMemberId) {
      byMember.set(conflict.ashedMemberId, conflict);
    }
  }

  const fromMembers = members
    .filter((m) => m.commander_sync_status === "name_conflict")
    .map((m) => ({
      ashedMemberId: m.id,
      currentName: m.current_name,
      existingMemberName:
        typeof m.commander_conflict?.existingMemberName === "string"
          ? m.commander_conflict.existingMemberName
          : undefined,
    }));

  if (fromMembers.length > 0) {
    return fromMembers;
  }

  return [...byMember.entries()].map(([ashedMemberId, conflict]) => {
    const member = members.find((m) => m.id === ashedMemberId);
    return {
      ashedMemberId,
      currentName: member?.current_name ?? conflict.normalizedName,
      existingMemberName: conflict.existingMemberName,
    };
  });
}

export function CommanderConflictResolutionSheet({
  open,
  onOpenChange,
  conflicts,
  members,
  gameServerNumber,
  onResolved,
}: Props) {
  const t = useTranslations("members.commanderConflicts");
  const initialRows = useMemo(
    () => conflictRowsFromPayload(conflicts, members),
    [conflicts, members],
  );
  const [rows, setRows] = useState<ConflictRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setRows(conflictRowsFromPayload(conflicts, members));
        setError(null);
      }
      onOpenChange(next);
    },
    [conflicts, members, onOpenChange],
  );

  const batchConflicts = useMemo(() => {
    if (gameServerNumber == null) return [];
    return detectBatchNameConflicts(
      rows.map((row, rowIndex) => ({
        extractedName: row.currentName,
        matchMemberId: row.ashedMemberId,
        rowIndex,
      })),
      gameServerNumber,
    );
  }, [gameServerNumber, rows]);

  const conflictRowIndexes = useMemo(
    () => new Set(batchConflicts.map((c) => c.rowIndex).filter((i) => i != null)),
    [batchConflicts],
  );

  const updateRow = useCallback((ashedMemberId: string, currentName: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.ashedMemberId === ashedMemberId ? { ...row, currentName } : row,
      ),
    );
  }, []);

  const saveAll = useCallback(async () => {
    if (saving || batchConflicts.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const row of rows) {
        const trimmed = row.currentName.trim();
        if (!trimmed) {
          throw new Error(t("nameRequired"));
        }
        const res = await fetch(`/api/members/${encodeURIComponent(row.ashedMemberId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentName: trimmed }),
        });
        const body = (await res.json()) as {
          error?: string;
          code?: string;
          conflicts?: CommanderIdentityConflict[];
        };
        if (res.status === 422 && body.code === "commander_identity_conflicts") {
          throw new Error(t("stillConflict"));
        }
        if (!res.ok) {
          throw new Error(body.error ?? t("saveFailed"));
        }
      }
      onResolved();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [batchConflicts.length, handleOpenChange, onResolved, rows, saving, t]);

  if (initialRows.length === 0) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t("title")}
      className="max-w-[min(96vw,40rem)]"
    >
      <div className="space-y-4">
        <p className="text-sm text-[#8b949e]">{t("description")}</p>

        <ul className="space-y-3">
          {rows.map((row, index) => {
            const hasBatchConflict = conflictRowIndexes.has(index);
            return (
              <li
                key={row.ashedMemberId}
                className={`rounded-lg border p-3 ${
                  hasBatchConflict
                    ? "border-[#f85149] bg-[#f8514911]"
                    : "border-[#30363d]"
                }`}
              >
                {row.existingMemberName ? (
                  <p className="mb-2 text-xs text-[#f85149]">
                    {t("takenBy", { name: row.existingMemberName })}
                  </p>
                ) : null}
                <label className="block text-xs text-[#8b949e]">{t("nameLabel")}</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded border border-[#30363d] bg-[#0d1117] px-2 py-1.5 text-sm"
                  value={row.currentName}
                  onChange={(e) => updateRow(row.ashedMemberId, e.target.value)}
                />
                {hasBatchConflict ? (
                  <p className="mt-1 text-xs text-[#f85149]">
                    {t("duplicateInBatch", {
                      name: normalizeCommanderName(row.currentName),
                    })}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm"
            onClick={() => handleOpenChange(false)}
            disabled={saving}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void saveAll()}
            disabled={saving || batchConflicts.length > 0}
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
