"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { useFeedback } from "@/components/feedback";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { useShellNavigation } from "@/components/ashed-shell/useShellNavigation";
import { Link, usePathname } from "@/i18n/navigation";
import {
  buildConnectHref,
  stashConnectReturnPath,
} from "@/lib/connect/connect-return-path.shared";

type Props = {
  userLabel: string | null;
  displayName: string | null;
  userEmail: string | null;
  avatarUrl?: string | null;
  showAdminPortal?: boolean;
  showConnectLink?: boolean;
  showMenu: boolean;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function ShellProfileMenu({
  userLabel,
  displayName,
  userEmail,
  avatarUrl = null,
  showAdminPortal = false,
  showConnectLink = false,
  showMenu,
}: Props) {
  const t = useTranslations("shell.profileMenu");
  const tFab = useTranslations("feedback.fab");
  const {
    showReportIssue,
    startTranslationCorrection,
    showExperienceFeedback,
    showGetInTouch,
  } = useFeedback();
  const { pushAndRefresh } = useShellNavigation();
  const pathname = usePathname();
  const connectHref = buildConnectHref(pathname);
  const menuId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [menuRect, setMenuRect] = React.useState<{
    top: number;
    right: number;
    minWidth: number;
  } | null>(null);

  const headerName = displayName ?? userLabel ?? t("unknownUser");
  const headerEmail = userEmail ?? t("unknownEmail");

  const updateMenuRect = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
      minWidth: Math.max(rect.width, 220),
    };
  }, []);

  function closeMenu() {
    setOpen(false);
  }

  React.useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`[data-shell-profile-menu="${menuId}"]`)
      ) {
        return;
      }
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuId, open]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const rect = updateMenuRect();
      if (rect) {
        setMenuRect(rect);
      }
    });

    function handleLayoutChange() {
      requestAnimationFrame(() => {
        const next = updateMenuRect();
        if (next) {
          setMenuRect(next);
        }
      });
    }

    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    };
  }, [open, updateMenuRect]);

  React.useEffect(() => {
    if (open) return;
    const frame = requestAnimationFrame(() => {
      setMenuRect(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  async function signOutHq() {
    setSigningOut(true);
    try {
      const res = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!res.ok) {
        setSigningOut(false);
        return;
      }
      closeMenu();
      pushAndRefresh("/auth", "signOut");
    } catch {
      setSigningOut(false);
    }
  }

  if (!showMenu) {
    if (!showConnectLink) {
      return null;
    }
    return (
      <Link
        href={connectHref}
        onClick={() => stashConnectReturnPath(pathname)}
        className="shrink-0 text-sm text-hq-accent hover:underline"
      >
        {t("connect")}
      </Link>
    );
  }

  const menu =
    open && menuRect
      ? createPortal(
          <div
            data-shell-profile-menu={menuId}
            role="menu"
            aria-label={t("openMenu")}
            className="fixed z-[100] overflow-hidden rounded-lg border border-hq-border bg-hq-surface py-1 shadow-lg"
            style={{
              top: menuRect.top,
              right: menuRect.right,
              minWidth: menuRect.minWidth,
            }}
          >
            <div
              className="flex items-center gap-3 border-b border-hq-border px-3 py-2.5"
              role="presentation"
            >
              <ProfileAvatar
                displayName={headerName}
                email={headerEmail}
                avatarUrl={avatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-hq-fg">
                  {headerName}
                </p>
                <p className="truncate text-xs text-hq-fg-muted">{headerEmail}</p>
              </div>
            </div>

            <Link
              href="/profile"
              role="menuitem"
              className="block px-3 py-2 text-sm text-hq-fg hover:bg-hq-surface-muted"
              onClick={closeMenu}
            >
              {t("profile")}
            </Link>
            <Link
              href="/account"
              role="menuitem"
              className="block px-3 py-2 text-sm text-hq-fg hover:bg-hq-surface-muted"
              onClick={closeMenu}
            >
              {t("account")}
            </Link>

            {showAdminPortal ? (
              <Link
                href="/admin"
                role="menuitem"
                className="block px-3 py-2 text-sm text-hq-fg hover:bg-hq-surface-muted"
                onClick={closeMenu}
              >
                {t("adminPortal")}
              </Link>
            ) : null}

            {showConnectLink ? (
              <Link
                href={connectHref}
                role="menuitem"
                className="block px-3 py-2 text-sm text-hq-accent hover:bg-hq-surface-muted"
                onClick={() => {
                  stashConnectReturnPath(pathname);
                  closeMenu();
                }}
              >
                {t("connect")}
              </Link>
            ) : null}

            <div className="mt-1 border-t border-hq-border pt-1">
              <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                {tFab("openMenu")}
              </p>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-surface-muted"
                onClick={() => {
                  closeMenu();
                  showReportIssue();
                }}
              >
                {tFab("reportBug")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-surface-muted"
                onClick={() => {
                  closeMenu();
                  startTranslationCorrection();
                }}
              >
                {tFab("correctTranslation")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-surface-muted"
                onClick={() => {
                  closeMenu();
                  showExperienceFeedback({
                    source: "unsolicited",
                    isSolicited: false,
                  });
                }}
              >
                {tFab("leaveFeedback")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-sm text-hq-fg hover:bg-hq-surface-muted"
                onClick={() => {
                  closeMenu();
                  showGetInTouch();
                }}
              >
                {tFab("getInTouch")}
              </button>
            </div>

            <div className="mt-1 border-t border-hq-border pt-1">
              <button
                type="button"
                role="menuitem"
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm text-hq-danger hover:bg-hq-surface-muted",
                  signingOut && "cursor-not-allowed opacity-50",
                )}
                disabled={signingOut}
                onClick={() => void signOutHq()}
              >
                {signingOut ? t("signingOut") : t("signOut")}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hq-accent"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("openMenu")}
        onClick={() => setOpen((current) => !current)}
      >
        <ProfileAvatar
          displayName={headerName}
          email={headerEmail}
          avatarUrl={avatarUrl}
          size="sm"
        />
      </button>
      {menu}
    </>
  );
}
