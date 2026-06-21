"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Link, useRouter } from "@/i18n/navigation";

type Props = {
  userLabel: string | null;
  displayName: string | null;
  userEmail: string | null;
  avatarUrl?: string | null;
  showAdminPortal?: boolean;
  isConnected: boolean;
  canUseAshedEmbeds?: boolean;
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
  isConnected,
  canUseAshedEmbeds = true,
  showMenu,
}: Props) {
  const t = useTranslations("shell.profileMenu");
  const router = useRouter();
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
        return;
      }
      closeMenu();
      router.push("/auth");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  if (!showMenu) {
    return (
      <Link
        href="/connect"
        className="shrink-0 text-sm text-[#58a6ff] hover:underline"
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
            className="fixed z-[100] overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] py-1 shadow-lg"
            style={{
              top: menuRect.top,
              right: menuRect.right,
              minWidth: menuRect.minWidth,
            }}
          >
            <div
              className="flex items-center gap-3 border-b border-[#30363d] px-3 py-2.5"
              role="presentation"
            >
              <ProfileAvatar
                displayName={headerName}
                email={headerEmail}
                avatarUrl={avatarUrl}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[#e6edf3]">
                  {headerName}
                </p>
                <p className="truncate text-xs text-[#8b949e]">{headerEmail}</p>
              </div>
            </div>

            <Link
              href="/profile"
              role="menuitem"
              className="block px-3 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
              onClick={closeMenu}
            >
              {t("profile")}
            </Link>
            <Link
              href="/account"
              role="menuitem"
              className="block px-3 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
              onClick={closeMenu}
            >
              {t("account")}
            </Link>

            {showAdminPortal ? (
              <Link
                href="/admin"
                role="menuitem"
                className="block px-3 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
                onClick={closeMenu}
              >
                {t("adminPortal")}
              </Link>
            ) : null}

            {!isConnected && canUseAshedEmbeds ? (
              <Link
                href="/connect"
                role="menuitem"
                className="block px-3 py-2 text-sm text-[#58a6ff] hover:bg-[#21262d]"
                onClick={closeMenu}
              >
                {t("connect")}
              </Link>
            ) : null}

            <div className="mt-1 border-t border-[#30363d] pt-1">
              <button
                type="button"
                role="menuitem"
                className={cn(
                  "block w-full px-3 py-2 text-left text-sm text-[#f85149] hover:bg-[#21262d]",
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
        className="inline-flex shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
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
