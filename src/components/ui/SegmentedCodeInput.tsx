"use client";

import { useRef, type InputHTMLAttributes } from "react";

type BaseProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  id?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  autoComplete?: string;
};

type JoinCodeProps = BaseProps & {
  format?: "join-code";
};

type FixedCodeProps = BaseProps & {
  format: "fixed";
  length: number;
  charset?: "numeric" | "alphanumeric";
};

type Props = JoinCodeProps | FixedCodeProps;

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

export function normalizeFixedCodeInput(
  raw: string,
  length: number,
  charset: "numeric" | "alphanumeric" = "numeric",
): string {
  const cleaned =
    charset === "numeric"
      ? raw.replace(/\D/g, "")
      : raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.slice(0, length);
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

function HiddenCodeInput({
  inputRef,
  value,
  onChange,
  onSubmit,
  id,
  autoFocus,
  ariaLabel,
  autoComplete,
  inputMode,
  autoCapitalize,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: () => void;
  id?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
  autoComplete?: string;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  autoCapitalize?: InputHTMLAttributes<HTMLInputElement>["autoCapitalize"];
}) {
  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      autoComplete={autoComplete ?? "off"}
      autoCorrect="off"
      autoCapitalize={autoCapitalize ?? "off"}
      spellCheck={false}
      enterKeyHint="send"
      inputMode={inputMode}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit?.();
      }}
      aria-label={ariaLabel}
      className="absolute inset-0 h-full w-full cursor-text opacity-0"
    />
  );
}

function JoinCodeLayout({
  value,
  onChange,
  onSubmit,
  id,
  autoFocus,
  "aria-label": ariaLabel,
  autoComplete,
}: BaseProps) {
  const inputRef = useRef<HTMLInputElement>(null);

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
        className="pointer-events-none flex select-none flex-col items-start gap-1.5"
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

      <HiddenCodeInput
        inputRef={inputRef}
        value={value}
        onChange={(e) => onChange(normalizeJoinCodeInput(e.target.value))}
        onSubmit={onSubmit}
        id={id}
        autoFocus={autoFocus}
        ariaLabel={ariaLabel}
        autoComplete={autoComplete}
        autoCapitalize="characters"
      />
    </div>
  );
}

function FixedCodeLayout({
  value,
  onChange,
  onSubmit,
  id,
  autoFocus,
  "aria-label": ariaLabel,
  autoComplete,
  length,
  charset = "numeric",
}: BaseProps & { length: number; charset: "numeric" | "alphanumeric" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cells = buildRowCells(value, length);
  const cursorIdx = cells.findIndex((cell) => !cell.char);

  return (
    <div className="relative">
      <div
        className="pointer-events-none flex select-none items-center gap-1.5"
        aria-hidden
      >
        {cells.map((cell, i) => (
          <div
            key={`fixed-${i}`}
            className={cellClassName(cell, i === cursorIdx)}
          >
            {cell.char}
          </div>
        ))}
      </div>

      <HiddenCodeInput
        inputRef={inputRef}
        value={value}
        onChange={(e) =>
          onChange(normalizeFixedCodeInput(e.target.value, length, charset))
        }
        onSubmit={onSubmit}
        id={id}
        autoFocus={autoFocus}
        ariaLabel={ariaLabel}
        autoComplete={autoComplete}
        inputMode={charset === "numeric" ? "numeric" : "text"}
      />
    </div>
  );
}

export function SegmentedCodeInput(props: Props) {
  if (props.format === "fixed") {
    return (
      <FixedCodeLayout
        value={props.value}
        onChange={props.onChange}
        onSubmit={props.onSubmit}
        id={props.id}
        autoFocus={props.autoFocus}
        aria-label={props["aria-label"]}
        autoComplete={props.autoComplete}
        length={props.length}
        charset={props.charset ?? "numeric"}
      />
    );
  }

  return <JoinCodeLayout {...props} />;
}
