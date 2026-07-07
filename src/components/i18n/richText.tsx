import type { ReactNode } from "react";

export function ashedLink(chunks: ReactNode) {
  return (
    <a
      href="https://ashed.online"
      target="_blank"
      rel="noreferrer"
      className="text-hq-accent hover:underline"
    >
      {chunks}
    </a>
  );
}

export function strongText(chunks: ReactNode) {
  return <strong className="text-hq-fg">{chunks}</strong>;
}

export function mutedText(chunks: ReactNode) {
  return <span className="text-hq-fg-muted">{chunks}</span>;
}

export function inlineCode(chunks: ReactNode) {
  return (
    <code className="rounded bg-hq-canvas px-1.5 py-0.5 font-mono text-[0.9em]">
      {chunks}
    </code>
  );
}

export function smallCode(chunks: ReactNode) {
  return (
    <code className="rounded bg-hq-canvas px-1 font-mono text-[0.85em]">
      {chunks}
    </code>
  );
}
