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
    <div className="space-y-4">
      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
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

      <div className="overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117]">
        <iframe
          src={url}
          title={t("iframeTitle", { path: title })}
          className="h-[min(70vh,720px)] w-full"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
        <p className="border-t border-[#30363d] px-4 py-2 text-xs text-[#8b949e]">
          {t("iframeHint")}
        </p>
      </div>
    </div>
  );
}
