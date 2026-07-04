"use client";

import { useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  id?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
};

// Max alphanumeric characters across prefix + suffix (4+6=10 typical).
// Hyphens are rendered as separators and don't count toward this limit.
const MAX_ALPHANUM_SLOTS = 10;
const MAX_CODE_LENGTH = MAX_ALPHANUM_SLOTS + 3; // allow a few hyphens + buffer

type Cell = { char: string; isSeparator: boolean };

function buildCells(value: string): { cells: Cell[]; cursorIdx: number } {
  const chars = value.split("");
  const filled: Cell[] = chars.map((c) => ({
    char: c,
    isSeparator: c === "-",
  }));

  const alphaNumersFilled = chars.filter((c) => c !== "-").length;
  const emptyCount = Math.max(0, MAX_ALPHANUM_SLOTS - alphaNumersFilled);
  const empty: Cell[] = Array.from({ length: emptyCount }, () => ({
    char: "",
    isSeparator: false,
  }));

  const cells = [...filled, ...empty];
  const cursorIdx = cells.findIndex((c) => !c.char && !c.isSeparator);

  return { cells, cursorIdx };
}

export function SegmentedCodeInput({
  value,
  onChange,
  onSubmit,
  id,
  autoFocus,
  "aria-label": ariaLabel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "")
      .slice(0, MAX_CODE_LENGTH);
    onChange(raw);
  }

  const { cells, cursorIdx } = buildCells(value);

  return (
    <div className="relative">
      {/* Visual character cells — pointer-events-none so the input below captures all interactions */}
      <div
        className="flex items-center gap-1.5 flex-wrap pointer-events-none select-none"
        aria-hidden
      >
        {cells.map((cell, i) =>
          cell.isSeparator ? (
            <span
              key={i}
              className="w-3 flex items-center justify-center font-mono text-lg font-bold text-[#8b949e] shrink-0"
            >
              -
            </span>
          ) : (
            <div
              key={i}
              className={[
                "w-9 h-11 rounded-md border-2 flex items-center justify-center font-mono text-lg font-semibold shrink-0 transition-colors duration-150",
                cell.char
                  ? "border-[#388bfd] bg-[#0d1117] text-[#e6edf3]"
                  : i === cursorIdx
                    ? "border-[#388bfd] bg-[#0d1117] animate-pulse"
                    : "border-[#30363d] bg-[#0d1117]",
              ].join(" ")}
            >
              {cell.char}
            </div>
          ),
        )}
      </div>

      {/* Hidden input — covers full area, captures all clicks and keyboard events */}
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleChange}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="send"
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit?.();
        }}
        aria-label={ariaLabel}
        // Covers the visual cells exactly so any click or tap focuses this input naturally.
        // opacity-0 keeps it invisible while still being interactive and accessible.
        className="absolute inset-0 w-full h-full opacity-0 cursor-text"
      />
    </div>
  );
}
