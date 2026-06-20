"use client";

import * as React from "react";

type Props = {
  displayName: string | null;
  email: string | null;
  avatarUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function profileInitials(
  displayName: string | null,
  email: string | null,
): string {
  const source = displayName?.trim() || email?.trim() || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

const sizeClasses = {
  sm: "h-10 w-10 text-sm",
  md: "h-16 w-16 text-lg",
} as const;

export function ProfileAvatar(props: Props) {
  return <ProfileAvatarInner key={props.avatarUrl ?? "fallback"} {...props} />;
}

function ProfileAvatarInner({
  displayName,
  email,
  avatarUrl,
  size = "sm",
  className,
}: Props) {
  const [imageFailed, setImageFailed] = React.useState(false);
  const showImage = Boolean(avatarUrl) && !imageFailed;
  const initials = profileInitials(displayName, email);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#30363d] bg-[#21262d] font-medium text-[#e6edf3]",
        sizeClasses[size],
        className,
      )}
      aria-hidden={showImage ? undefined : true}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- external OAuth / game CDN URLs
        <img
          key={avatarUrl}
          src={avatarUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span>{initials}</span>
      )}
    </span>
  );
}

export { profileInitials };
