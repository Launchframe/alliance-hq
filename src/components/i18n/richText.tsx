import type { ReactNode } from "react";

export function ashedLink(chunks: ReactNode) {
  return (
    <a
      href="https://ashed.online"
      target="_blank"
      rel="noreferrer"
      className="text-[#58a6ff] hover:underline"
    >
      {chunks}
    </a>
  );
}

export function strongText(chunks: ReactNode) {
  return <strong className="text-[#e6edf3]">{chunks}</strong>;
}

export function mutedText(chunks: ReactNode) {
  return <span className="text-[#8b949e]">{chunks}</span>;
}

export function inlineCode(chunks: ReactNode) {
  return (
    <code className="rounded bg-[#0d1117] px-1.5 py-0.5 font-mono text-[0.9em]">
      {chunks}
    </code>
  );
}

export function smallCode(chunks: ReactNode) {
  return (
    <code className="rounded bg-[#0d1117] px-1 font-mono text-[0.85em]">
      {chunks}
    </code>
  );
}
