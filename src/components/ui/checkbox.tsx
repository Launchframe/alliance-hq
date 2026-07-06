"use client";

import * as React from "react";
import { Check } from "lucide-react";

type CheckboxProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange"
> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};

export function Checkbox({
  checked = false,
  onCheckedChange,
  className = "",
  id,
  ...props
}: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      id={id}
      onClick={() => onCheckedChange?.(!checked)}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-hq-border bg-hq-canvas text-white transition hover:border-hq-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hq-accent disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-hq-success bg-hq-success" : ""
      } ${className}`}
      {...props}
    >
      {checked ? (
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
      ) : null}
    </button>
  );
}
