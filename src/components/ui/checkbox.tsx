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
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#30363d] bg-[#0d1117] text-white transition hover:border-[#58a6ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#58a6ff] disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-[#238636] bg-[#238636]" : ""
      } ${className}`}
      {...props}
    >
      {checked ? (
        <Check className="h-4 w-4" strokeWidth={3} aria-hidden />
      ) : null}
    </button>
  );
}
