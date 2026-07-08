"use client";

import * as React from "react";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className = "", ...props }: TextareaProps) {
  return (
    <textarea
      className={`min-h-[96px] w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg outline-none ring-hq-accent focus:ring-2 ${className}`}
      {...props}
    />
  );
}
