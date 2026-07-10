import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";

type Props = {
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AnalyticsCard({
  title,
  description,
  href,
  linkLabel,
  children,
  footer,
}: Props) {
  return (
    <section className="rounded-2xl border border-hq-border bg-hq-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-hq-fg">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-hq-fg-muted">{description}</p>
          ) : null}
        </div>
        {href && linkLabel ? (
          <Link
            href={href}
            className="text-sm font-medium text-hq-accent hover:underline"
          >
            {linkLabel} →
          </Link>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
      {footer ? <div className="mt-4 border-t border-hq-border pt-4">{footer}</div> : null}
    </section>
  );
}
