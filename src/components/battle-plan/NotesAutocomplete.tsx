"use client";

import { useMemo, useState } from "react";

import { filterNoteSuggestions } from "@/lib/battle-plan/notes-suggestions.shared";

type Props = {
  value: string;
  suggestions: readonly string[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
};

export function NotesAutocomplete({
  value,
  suggestions,
  disabled,
  placeholder,
  onChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const filtered = useMemo(
    () => filterNoteSuggestions(suggestions, value),
    [suggestions, value],
  );
  const showSuggestions = focused && filtered.length > 0;

  return (
    <div className="relative">
      <textarea
        className="min-h-20 w-full rounded border border-hq-border bg-hq-bg px-3 py-2"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          window.setTimeout(() => setFocused(false), 120);
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      {showSuggestions ? (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded border border-hq-border bg-hq-surface shadow-lg">
          {filtered.map((suggestion) => (
            <li key={suggestion.toLowerCase()}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-hq-bg"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(suggestion);
                  setFocused(false);
                }}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
