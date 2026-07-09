"use client";

import { PanelLeftClose, PanelRightClose } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { AshedEmbedPane } from "@/components/hybrid-ashed/AshedEmbedPane";
import { useHybridAshedLayout } from "@/components/hybrid-ashed/useHybridAshedLayout";
import type { HybridAshedPageId } from "@/lib/nav/hybrid-pages";
import { HYBRID_ASHED_PAGES } from "@/lib/nav/hybrid-pages";

type Props = {
  pageId: HybridAshedPageId;
  canUseAshedPane: boolean;
  children: ReactNode;
};

export function HybridAshedPageShell({ pageId, canUseAshedPane, children }: Props) {
  const t = useTranslations("hybridAshed");
  const tNav = useTranslations("nav");
  const page = HYBRID_ASHED_PAGES[pageId];
  const title = tNav(page.labelKey);
  const { prefs, setMobilePane, setHqRatio, setHqCollapsed, setAshedCollapsed } =
    useHybridAshedLayout(pageId);
  const dragRef = useRef<{ startX: number; startRatio: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragRef.current) return;
      const container = document.getElementById(`hybrid-shell-${pageId}`);
      if (!container) return;
      const width = container.clientWidth;
      if (width <= 0) return;
      const delta = (event.clientX - dragRef.current.startX) / width;
      setHqRatio(dragRef.current.startRatio + delta);
    },
    [pageId, setHqRatio],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  if (!canUseAshedPane) {
    return <>{children}</>;
  }

  const { desktop, mobile } = prefs;
  const hqWidth = desktop.ashedCollapsed
    ? "100%"
    : desktop.hqCollapsed
      ? "0%"
      : `${Math.round(desktop.hqRatio * 100)}%`;
  const ashedWidth = desktop.hqCollapsed
    ? "100%"
    : desktop.ashedCollapsed
      ? "0%"
      : `${Math.round((1 - desktop.hqRatio) * 100)}%`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-hq-border bg-hq-surface px-4 py-2 lg:hidden">
        <div className="inline-flex rounded-lg border border-hq-border bg-hq-canvas p-1">
          <button
            type="button"
            onClick={() => setMobilePane("hq")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              mobile.activePane === "hq"
                ? "bg-hq-accent text-white"
                : "text-hq-fg-muted hover:text-hq-fg"
            }`}
          >
            {t("hqPane")}
          </button>
          <button
            type="button"
            onClick={() => setMobilePane("ashed")}
            className={`rounded-md px-3 py-1.5 text-sm ${
              mobile.activePane === "ashed"
                ? "bg-hq-accent text-white"
                : "text-hq-fg-muted hover:text-hq-fg"
            }`}
          >
            {t("ashedPane")}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        {mobile.activePane === "hq" ? (
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        ) : (
          <AshedEmbedPane path={page.ashedPath} title={title} />
        )}
      </div>

      <div
        id={`hybrid-shell-${pageId}`}
        className={`hidden min-h-0 flex-1 lg:flex ${dragging ? "select-none" : ""}`}
      >
        {!desktop.hqCollapsed ? (
          <div
            className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-hq-border"
            style={{ width: hqWidth }}
          >
            <div className="flex items-center justify-end border-b border-hq-border px-2 py-1">
              <button
                type="button"
                onClick={() => setHqCollapsed(true)}
                className="rounded p-1 text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
                title={t("minimizeHq")}
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setHqCollapsed(false)}
            className="w-8 shrink-0 border-r border-hq-border bg-hq-surface text-xs text-hq-fg-muted hover:text-hq-fg"
            title={t("restoreHq")}
          >
            HQ
          </button>
        )}

        {!desktop.hqCollapsed && !desktop.ashedCollapsed ? (
          <div
            className="w-1 shrink-0 cursor-col-resize bg-hq-border hover:bg-hq-accent/60"
            onPointerDown={(event) => {
              dragRef.current = { startX: event.clientX, startRatio: desktop.hqRatio };
              setDragging(true);
              window.addEventListener("pointermove", onPointerMove);
              window.addEventListener("pointerup", endDrag);
            }}
          />
        ) : null}

        {!desktop.ashedCollapsed ? (
          <div className="flex min-h-0 min-w-0 flex-col" style={{ width: ashedWidth }}>
            <div className="flex items-center justify-start border-b border-hq-border px-2 py-1">
              <button
                type="button"
                onClick={() => setAshedCollapsed(true)}
                className="rounded p-1 text-hq-fg-muted hover:bg-hq-surface-muted hover:text-hq-fg"
                title={t("minimizeAshed")}
              >
                <PanelRightClose className="h-4 w-4" />
              </button>
            </div>
            <AshedEmbedPane path={page.ashedPath} title={title} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAshedCollapsed(false)}
            className="w-8 shrink-0 border-l border-hq-border bg-hq-surface text-xs text-hq-fg-muted hover:text-hq-fg"
            title={t("restoreAshed")}
          >
            A
          </button>
        )}
      </div>
    </div>
  );
}
