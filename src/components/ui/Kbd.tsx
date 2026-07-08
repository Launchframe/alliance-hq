import type { ReactNode } from "react";

const kbdClassName =
  "inline-flex min-h-[1.35rem] min-w-[1.35rem] items-center justify-center rounded-md border border-hq-border bg-hq-surface-muted px-1.5 font-mono text-[0.8125rem] font-medium leading-none text-hq-fg shadow-[inset_0_-1px_0_#0d1117]";

type KbdProps = {
  children: ReactNode;
  className?: string;
};

/** Single key cap — use for hotkeys, shortcuts, and literal key names. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd className={className ? `${kbdClassName} ${className}` : kbdClassName}>
      {children}
    </kbd>
  );
}

type KbdComboProps = {
  /** Key labels in order, e.g. ["Ctrl", "Shift", "I"] */
  keys: string[];
  className?: string;
};

/** Chord shortcut, e.g. Ctrl + Shift + I */
export function KbdCombo({ keys, className }: KbdComboProps) {
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1 ${className ?? ""}`}
    >
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="inline-flex items-center gap-1">
          {index > 0 && (
            <span className="font-mono text-xs text-hq-fg-muted" aria-hidden>
              +
            </span>
          )}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  );
}

type KbdOrProps = {
  options: ReactNode[];
  className?: string;
};

/** Alternatives separated by “or”, e.g. F12 or Ctrl+Shift+I */
export function KbdOr({ options, className }: KbdOrProps) {
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 ${className ?? ""}`}
    >
      {options.map((option, index) => (
        <span key={index} className="inline-flex items-center gap-1.5">
          {index > 0 && (
            <span className="text-xs text-hq-fg-muted">or</span>
          )}
          {option}
        </span>
      ))}
    </span>
  );
}
