"use client";

import { useMemo } from "react";

import { renderReleaseNoteMarkdown } from "@/lib/release-notes/render-markdown";

type Props = {
  markdown: string;
  className?: string;
};

export function ReleaseNoteMarkdown({ markdown, className = "" }: Props) {
  const html = useMemo(() => renderReleaseNoteMarkdown(markdown), [markdown]);

  if (!html) {
    return null;
  }

  return (
    <div
      className={`prose prose-invert max-w-none text-sm text-[#c9d1d9] [&_a]:text-[#58a6ff] [&_a]:underline [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
