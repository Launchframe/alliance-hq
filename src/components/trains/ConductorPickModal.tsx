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
  onClose: () => void;
  onPick: (member: RosterMember) => void;
};

export function ConductorPickModal({
  open,
  members,
  title,
  searchPlaceholder,
  emptyLabel,
  cancelLabel,
  onClose,
  onPick,
}: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.memberName.toLowerCase().includes(q));
  }, [members, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conductor-pick-title"
    >
      <div className="flex max-h-[min(80vh,560px)] w-full max-w-md flex-col rounded-2xl border border-[#30363d] bg-[#161b22] shadow-2xl">
        <div className="border-b border-[#30363d] p-4">
          <h2
            id="conductor-pick-title"
            className="text-lg font-semibold text-[#e6edf3]"
          >
            {title}
          </h2>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="mt-3 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder:text-[#8b949e] focus:border-[#58a6ff] focus:outline-none"
            autoFocus
          />
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-[#8b949e]">
              {emptyLabel}
            </li>
          ) : (
            filtered.map((member) => (
              <li key={member.memberId}>
                <button
                  type="button"
                  onClick={() => onPick(member)}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[#e6edf3] hover:bg-[#0d1117]"
                >
                  {member.memberName}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="border-t border-[#30363d] p-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#0d1117]"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
