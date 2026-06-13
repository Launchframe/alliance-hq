"use client";

import { ashedUrlForPath } from "@/lib/nav/routes";

type Props = {
  path: string;
};

export function AshedEmbed({ path }: Props) {
  const url = ashedUrlForPath(path);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h1 className="text-xl font-semibold capitalize">
          {path.replace(/^\//, "").replace(/-/g, " ") || "Ashed"}
        </h1>
        <p className="mt-2 text-sm text-[#8b949e]">
          This page lives on Ashed. Open it below or in a new tab — your
          Alliance HQ sidebar stays here.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white hover:bg-[#2ea043]"
          >
            Open in Ashed ↗
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117]">
        <iframe
          src={url}
          title={`Ashed — ${path}`}
          className="h-[min(70vh,720px)] w-full"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
        <p className="border-t border-[#30363d] px-4 py-2 text-xs text-[#8b949e]">
          If the frame is blank, Ashed may block embedding — use &quot;Open in
          Ashed&quot; above.
        </p>
      </div>
    </div>
  );
}
