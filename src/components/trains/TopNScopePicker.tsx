"use client";

import { useTranslations } from "next-intl";

import {
  isVrTopScopeUnlocked,
  scopesForPaintTemplate,
  vrReportersRequiredForTopN,
  type ConductorTopN,
} from "@/lib/trains/conductor-top-n.shared";

type Props = {
  paintTemplate: "top_vs" | "top_vr";
  vrReporterCount: number;
  onSelect: (topN: ConductorTopN) => void;
  onBack?: () => void;
};

export function TopNScopePicker({
  paintTemplate,
  vrReporterCount,
  onSelect,
  onBack,
}: Props) {
  const t = useTranslations("trains.topNScope");
  const scopes = scopesForPaintTemplate(paintTemplate);
  const kind = paintTemplate === "top_vr" ? "vr" : "vs";

  return (
    <div className="flex flex-col" data-testid="trains-topn-scope-picker">
      <div className="flex items-center gap-2 border-b border-hq-border px-3 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-cyan-400 hover:text-cyan-300"
            data-testid="trains-topn-scope-back"
          >
            {t("back")}
          </button>
        ) : null}
        <p className="text-xs font-medium text-hq-fg">
          {kind === "vs" ? t("titleVs") : t("titleVr")}
        </p>
      </div>
      <div className="py-1">
        {scopes.map((topN) => {
          const locked =
            kind === "vr" && !isVrTopScopeUnlocked(topN, vrReporterCount);
          const required = vrReportersRequiredForTopN(topN);
          return (
            <button
              key={topN}
              type="button"
              role="menuitem"
              disabled={locked}
              data-testid={`trains-topn-scope-${kind}-${topN}`}
              onClick={() => {
                if (!locked) onSelect(topN);
              }}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
                locked
                  ? "cursor-not-allowed text-hq-fg-muted opacity-60"
                  : "text-hq-fg hover:bg-hq-canvas"
              }`}
            >
              <span className="font-medium">
                {t("scopeLabel", { count: topN })}
              </span>
              {locked ? (
                <span className="text-[10px] text-hq-fg-muted">
                  {t("vrLocked", {
                    required,
                    have: vrReporterCount,
                    count: topN,
                  })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
