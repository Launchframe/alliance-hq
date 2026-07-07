"use client";

import { useMemo, useState } from "react";

type RosterMember = {
  memberId: string;
  memberName: string;
};

type Props = {
  open: boolean;
  members: RosterMember[];
  title: string;
  searchPlaceholder: string;
  emptyLabel: string;
  cancelLabel: string;
  confirmLabel: string;
  showGuardianToggle?: boolean;
  guardianIsVipLabel?: string;
  onClose: () => void;
  onPick: (member: RosterMember, guardianIsVip: boolean) => void;
};

export function ConductorPickModal({
  open,
  members,
  title,
  searchPlaceholder,
  emptyLabel,
  cancelLabel,
  confirmLabel,
  showGuardianToggle = false,
  guardianIsVipLabel,
  onClose,
  onPick,
}: Props) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guardianIsVip, setGuardianIsVip] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.memberName.toLowerCase().includes(q));
  }, [members, query]);

  const selected = members.find((m) => m.memberId === selectedId) ?? null;

  if (!open) return null;

  const handleClose = () => {
    setQuery("");
    setSelectedId(null);
    setGuardianIsVip(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conductor-pick-title"
    >
      <div className="flex max-h-[min(80vh,560px)] w-full max-w-md flex-col rounded-2xl border border-hq-border bg-hq-surface shadow-2xl">
        <div className="border-b border-hq-border p-4">
          <h2
            id="conductor-pick-title"
            className="text-lg font-semibold text-hq-fg"
          >
            {title}
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="mt-3 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg placeholder:text-hq-fg-muted focus:border-hq-accent focus:outline-none"
            autoFocus
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-hq-fg-muted">
              {emptyLabel}
            </li>
          ) : (
            filtered.map((member) => {
              const isSelected = member.memberId === selectedId;
              return (
                <li key={member.memberId}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(member.memberId)}
                    className={`w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                      isSelected
                        ? "bg-hq-accent/15 text-hq-accent"
                        : "text-hq-fg hover:bg-hq-canvas"
                    }`}
                  >
                    {member.memberName}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {showGuardianToggle && guardianIsVipLabel ? (
          <label className="flex cursor-pointer items-center gap-2 border-t border-hq-border px-4 py-3 text-sm text-[#c9d1d9]">
            <input
              type="checkbox"
              checked={guardianIsVip}
              onChange={(e) => setGuardianIsVip(e.target.checked)}
              className="h-4 w-4 rounded border-hq-border bg-hq-canvas"
            />
            {guardianIsVipLabel}
          </label>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-hq-border p-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm text-hq-fg hover:bg-hq-canvas"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onPick(selected, guardianIsVip);
              setQuery("");
              setSelectedId(null);
              setGuardianIsVip(false);
            }}
            className="rounded-lg bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
