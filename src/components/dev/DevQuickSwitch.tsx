"use client";

import * as React from "react";

import {
  buildTestMatrixAccounts,
  TEST_MATRIX_ALLIANCES,
  type TestMatrixAccount,
} from "@/lib/dev/test-matrix";

const SWITCH_ENDPOINT = "/api/dev/test-matrix/switch";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type GroupedAccounts = {
  key: string;
  heading: string;
  accounts: TestMatrixAccount[];
};

function groupAccounts(accounts: TestMatrixAccount[]): GroupedAccounts[] {
  const groups: GroupedAccounts[] = TEST_MATRIX_ALLIANCES.map((alliance) => ({
    key: alliance.key,
    heading: `${alliance.defaultTag} · ${alliance.mode}`,
    accounts: accounts.filter(
      (a) => a.allianceKey === alliance.key && !a.platformMaintainer,
    ),
  }));

  const maintainers = accounts.filter((a) => a.platformMaintainer);
  if (maintainers.length > 0) {
    groups.push({
      key: "platform",
      heading: "Platform",
      accounts: maintainers,
    });
  }

  return groups;
}

export function DevQuickSwitch() {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const accounts = React.useMemo(() => buildTestMatrixAccounts(), []);
  const groups = React.useMemo(() => groupAccounts(accounts), [accounts]);

  const handleSwitch = React.useCallback(async (email: string) => {
    setBusy(email);
    setError(null);
    try {
      const res = await fetch(SWITCH_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(`Switch failed: ${detail.error ?? res.status}`);
        setBusy(null);
        return;
      }
      window.location.assign("/");
    } catch (err) {
      setError(`Switch failed: ${String(err)}`);
      setBusy(null);
    }
  }, []);

  const handleExit = React.useCallback(async () => {
    setBusy("__exit__");
    try {
      await fetch(SWITCH_ENDPOINT, { method: "DELETE" });
    } finally {
      window.location.assign("/");
    }
  }, []);

  return (
    <div className="fixed bottom-4 left-4 z-[200] flex flex-col items-start gap-2 print:hidden">
      {open ? (
        <div className="flex max-h-[70vh] w-[19rem] flex-col overflow-hidden rounded-xl border border-amber-500/40 bg-[#161b22] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#30363d] px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-amber-400">
              Dev quick-switch
            </span>
            <button
              type="button"
              className="rounded px-2 py-0.5 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {groups.map((group) => (
              <div key={group.key} className="mb-3 last:mb-0">
                <p className="px-1 pb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-[#6e7681]">
                  {group.heading}
                </p>
                <ul className="space-y-1">
                  {group.accounts.map((account) => (
                    <li key={account.email}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => handleSwitch(account.email)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-xs text-[#e6edf3] transition-colors hover:border-[#30363d] hover:bg-[#21262d]",
                          busy === account.email && "opacity-60",
                        )}
                      >
                        <span className="truncate">
                          {account.platformMaintainer
                            ? account.displayName
                            : account.role}
                        </span>
                        {account.ashed ? (
                          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[0.6rem] font-medium text-emerald-300">
                            Ashed
                          </span>
                        ) : (
                          <span className="shrink-0 text-[0.6rem] text-[#6e7681]">
                            no Ashed
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-[#30363d] px-3 py-2">
            {error ? (
              <p className="mb-2 text-[0.65rem] text-red-400" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy !== null}
              onClick={handleExit}
              className="w-full rounded-md border border-[#30363d] px-2 py-1.5 text-xs text-[#e6edf3] transition-colors hover:bg-[#21262d] disabled:opacity-60"
            >
              Exit / return to me
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-amber-500/50 bg-[#161b22] px-3 py-1.5 text-xs font-semibold text-amber-400 shadow-lg transition-colors hover:bg-[#21262d]"
        aria-expanded={open}
      >
        {open ? "▾" : "▴"} Dev users
      </button>
    </div>
  );
}
