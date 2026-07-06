"use client";

import { useEffect, useMemo, useRef } from "react";

import { renderReleaseNoteMarkdown } from "@/lib/release-notes/render-markdown";

type Props = {
  markdown: string;
  className?: string;
};

async function renderMermaidBlocks(container: HTMLElement): Promise<void> {
  const blocks = container.querySelectorAll<HTMLElement>(".mermaid");
  if (blocks.length === 0) {
    return;
  }

  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
  });

  for (const block of blocks) {
    const original = block.getAttribute("data-mermaid-source");
    if (original != null) {
      block.textContent = original;
      block.removeAttribute("data-processed");
    } else {
      block.setAttribute("data-mermaid-source", block.textContent ?? "");
    }
  }

  await mermaid.run({ nodes: Array.from(blocks) });
}

export function ReleaseNoteMarkdown({ markdown, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderReleaseNoteMarkdown(markdown), [markdown]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !html) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await renderMermaidBlocks(container);
      } catch {
        if (!cancelled) {
          // Leave the source diagram visible if rendering fails.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [html]);

  if (!html) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`prose prose-invert max-w-none text-sm text-[#c9d1d9] [&_.mermaid]:my-4 [&_a]:text-[#58a6ff] [&_a]:underline [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
