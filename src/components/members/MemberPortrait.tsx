"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { fetchMemberPortrait } from "@/lib/trains/prompt-templates-client";

type Props = {
  allianceTag: string;
  memberId: string;
  memberName: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  eager?: boolean;
};

const sizeClasses = {
  sm: "h-10 w-10 text-xs",
  md: "h-16 w-16 text-sm",
  lg: "h-24 w-24 text-base",
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function MemberPortrait({
  allianceTag,
  memberId,
  memberName,
  size = "md",
  className = "",
  eager = false,
}: Props) {
  const t = useTranslations("members.portrait");
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!eager) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void fetchMemberPortrait({ allianceTag, memberId })
        .then((result) => {
          if (cancelled) return;
          setUrl(result.url);
          if (!result.url) setFailed(true);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allianceTag, eager, memberId]);

  const loadPortrait = () => {
    if (loading || url) return;
    setLoading(true);
    setFailed(false);
    void fetchMemberPortrait({ allianceTag, memberId })
      .then((result) => {
        setUrl(result.url);
        if (!result.url) setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  const shellClass = `relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#30363d] bg-[#0d1117] ${sizeClasses[size]} ${className}`;

  if (url) {
    return (
      <div className={shellClass}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={shellClass} aria-busy="true" aria-label={memberName}>
        <span className="animate-pulse text-[#8b949e]">…</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${shellClass} font-semibold text-[#58a6ff] hover:border-[#58a6ff]/60`}
      onClick={loadPortrait}
      aria-label={
        failed
          ? t("retry", { name: memberName })
          : t("load", { name: memberName })
      }
      title={failed ? t("retryTitle") : t("loadTitle")}
    >
      {initialsFromName(memberName)}
    </button>
  );
}
