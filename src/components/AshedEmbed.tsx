"use client";

import { useTranslations } from "next-intl";

import { ashedUrlForPath } from "@/lib/nav/routes";

type Props = {
  path: string;
  labelKey?: string;
};

export function AshedEmbed({ path, labelKey }: Props) {
  const t = useTranslations("ashedEmbed");
  const tNav = useTranslations("nav");
  const url = ashedUrlForPath(path);
  const title = labelKey ? tNav(labelKey) : path;

  return (
    <div className="-mx-4 -mb-4 flex min-h-0 flex-1 flex-col md:mx-0 md:mb-0 md:space-y-4">
      <div className="hidden rounded-xl border border-[#30363d] bg-[#161b22] p-5 md:block">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-[#8b949e]">{t("description")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white hover:bg-[#2ea043]"
          >
            {t("openInAshed")}
          </a>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0d1117] md:rounded-xl md:border md:border-[#30363d]">
        <iframe
          src={url}
          title={t("iframeTitle", { path: title })}
          className="min-h-0 w-full flex-1 md:h-[min(70vh,720px)] md:flex-none"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
        <p className="hidden border-t border-[#30363d] px-4 py-2 text-xs text-[#8b949e] md:block">
          {t("iframeHint")}
        </p>
      </div>
    </div>
  );
}
