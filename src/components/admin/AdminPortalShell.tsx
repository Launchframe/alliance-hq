"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { ADMIN_LINKS } from "@/lib/admin/nav-links";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function adminLinkActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    return pathname === "/admin";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

type Props = {
  children: React.ReactNode;
};

export function AdminPortalShell({ children }: Props) {
  const pathname = usePathname();
  const t = useTranslations("admin");
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const closeMobileNav = React.useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMobileNavOpen(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  React.useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  const navLinkClass = (active: boolean) =>
    cn(
      "block rounded-lg px-3 py-2 text-sm transition-colors",
      active
        ? "bg-[#1f3d5c] font-medium text-[#58a6ff]"
        : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]",
    );

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-4 md:space-y-6">
      <div className="lg:hidden">
        <div className="mb-3">
          <h1 className="text-xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-[#e6edf3] transition-colors hover:bg-[#21262d]"
          onClick={() => setMobileNavOpen(true)}
          aria-expanded={mobileNavOpen}
          aria-label={t("nav.openSections")}
        >
          <Menu className="h-4 w-4" aria-hidden />
          {t("nav.openSections")}
        </button>
      </div>

      <div
        className={cn(
          "fixed inset-0 z-[60] bg-black/60 transition-opacity duration-300 ease-out lg:hidden",
          mobileNavOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
        aria-hidden={!mobileNavOpen}
        onClick={closeMobileNav}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[70] flex w-full max-w-[min(100vw,18rem)] flex-col border-r border-[#30363d] bg-[#161b22] transition-transform duration-300 ease-out lg:hidden",
          mobileNavOpen
            ? "translate-x-0"
            : "-translate-x-full pointer-events-none",
        )}
      >
        <div className="flex items-center justify-between border-b border-[#30363d] px-4 py-3">
          <p className="text-sm font-semibold">{t("nav.sectionsTitle")}</p>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#30363d] text-[#e6edf3]"
            onClick={closeMobileNav}
            aria-label={t("nav.closeSections")}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {ADMIN_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={closeMobileNav}
                  className={navLinkClass(adminLinkActive(pathname, link.href))}
                >
                  {t(`nav.${link.labelKey}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="hidden lg:block">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <nav className="hidden flex-wrap gap-2 border-b border-[#30363d] pb-4 lg:flex">
        {ADMIN_LINKS.map((link) => {
          const active = adminLinkActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-[#1f3d5c] font-medium text-[#58a6ff]"
                  : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]",
              )}
            >
              {t(`nav.${link.labelKey}`)}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
