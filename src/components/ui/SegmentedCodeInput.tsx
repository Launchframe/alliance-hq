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

/** Alliance tag segment before the hyphen (e.g. LFgo). */
const PREFIX_MAX = 10;
/** Random suffix after the hyphen (6 hex chars in generated codes). */
const SUFFIX_MAX = 6;
const MIN_PREFIX_VISIBLE_SLOTS = 4;

type Cell = { char: string };

export function splitJoinCodeInput(value: string): {
  prefix: string;
  suffix: string;
  hasHyphen: boolean;
} {
  const hyphenIdx = value.indexOf("-");
  if (hyphenIdx === -1) {
    return { prefix: value, suffix: "", hasHyphen: false };
  }
  return {
    prefix: value.slice(0, hyphenIdx),
    suffix: value.slice(hyphenIdx + 1).replace(/-/g, ""),
    hasHyphen: true,
  };
}

export function normalizeJoinCodeInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  const hyphenIdx = cleaned.indexOf("-");
  if (hyphenIdx === -1) {
    return cleaned.slice(0, PREFIX_MAX);
  }

  const prefix = cleaned.slice(0, hyphenIdx).slice(0, PREFIX_MAX);
  const suffix = cleaned
    .slice(hyphenIdx + 1)
    .replace(/-/g, "")
    .slice(0, SUFFIX_MAX);
  return `${prefix}-${suffix}`;
}

function visibleSlotCount(filledLen: number, max: number, min: number): number {
  return Math.min(max, Math.max(min, filledLen + 1));
}

function buildRowCells(chars: string, visibleSlots: number): Cell[] {
  const filled = chars.split("").map((char) => ({ char }));
  const emptyCount = Math.max(0, visibleSlots - filled.length);
  const empty = Array.from({ length: emptyCount }, () => ({ char: "" }));
  return [...filled, ...empty];
}

function cellClassName(cell: Cell, isCursor: boolean): string {
  return [
    "w-9 h-11 rounded-md border-2 flex items-center justify-center font-mono text-lg font-semibold shrink-0 transition-colors duration-150",
    cell.char
      ? "border-[#388bfd] bg-[#0d1117] text-[#e6edf3]"
      : isCursor
        ? "border-[#388bfd] bg-[#0d1117] animate-pulse"
        : "border-[#30363d] bg-[#0d1117]",
  ].join(" ");
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
    onChange(normalizeJoinCodeInput(e.target.value));
  }

  const { prefix, suffix, hasHyphen } = splitJoinCodeInput(value);
  const cursorInPrefix = !hasHyphen;
  const prefixVisibleSlots = visibleSlotCount(
    prefix.length,
    PREFIX_MAX,
    MIN_PREFIX_VISIBLE_SLOTS,
  );
  const prefixCells = buildRowCells(prefix, prefixVisibleSlots);
  const suffixCells = buildRowCells(suffix, SUFFIX_MAX);
  const cursorPrefixIdx = prefixCells.findIndex((cell) => !cell.char);
  const cursorSuffixIdx = suffixCells.findIndex((cell) => !cell.char);

  return (
    <div className="relative">
      <div
        className="flex flex-col items-start gap-1.5 pointer-events-none select-none"
        aria-hidden
      >
        <div className="flex items-center gap-1.5">
          {prefixCells.map((cell, i) => (
            <div
              key={`prefix-${i}`}
              className={cellClassName(
                cell,
                cursorInPrefix && i === cursorPrefixIdx,
              )}
            >
              {cell.char}
            </div>
          ))}
          <span className="flex h-11 w-3 shrink-0 items-center justify-center font-mono text-lg font-bold text-[#8b949e]">
            -
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {suffixCells.map((cell, i) => (
            <div
              key={`suffix-${i}`}
              className={cellClassName(
                cell,
                hasHyphen && i === cursorSuffixIdx,
              )}
            >
              {cell.char}
            </div>
          ))}
        </div>
      </div>

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
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}
