"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSelect, type AppSelectOption } from "@/components/ui/AppSelect";

export function ActivityLookupSelect({
  ariaLabel,
  value,
  onChange,
  options,
  searchPlaceholder,
  noSearchResultsLabel,
  onSearchQuery,
  hasError,
  errorSignal,
  onRetry,
  retryLabel,
  loadFailedLabel,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  searchPlaceholder: string;
  noSearchResultsLabel: string;
  onSearchQuery: (query: string) => void;
  hasError: boolean;
  errorSignal: number;
  onRetry: () => void;
  retryLabel: string;
  loadFailedLabel: string;
}) {
  const [selectedOption, setSelectedOption] =
    useState<AppSelectOption | null>(null);
  const alertRef = useRef<HTMLParagraphElement | null>(null);
  const lastSignalRef = useRef(0);

  const mergedOptions = useMemo(() => {
    if (!value || options.some((option) => option.value === value)) {
      return options;
    }
    if (selectedOption && selectedOption.value === value) {
      return [...options, selectedOption];
    }
    return options;
  }, [options, selectedOption, value]);

  const handleChange = useCallback(
    (next: string) => {
      if (next) {
        const found = mergedOptions.find((option) => option.value === next);
        if (found) setSelectedOption(found);
      } else {
        setSelectedOption(null);
      }
      onChange(next);
    },
    [mergedOptions, onChange],
  );

  const handleSearch = useCallback(
    (query: string) => {
      onSearchQuery(query);
    },
    [onSearchQuery],
  );

  useEffect(() => {
    if (errorSignal <= lastSignalRef.current) return;
    lastSignalRef.current = errorSignal;
    alertRef.current?.scrollIntoView({ block: "nearest" });
  }, [errorSignal]);

  return (
    <div className="w-full">
      <AppSelect
        value={value}
        onChange={handleChange}
        options={mergedOptions}
        searchable
        searchPlaceholder={searchPlaceholder}
        noSearchResultsLabel={noSearchResultsLabel}
        onSearchQueryChange={handleSearch}
        aria-label={ariaLabel}
      />
      {hasError ? (
        <p
          ref={alertRef}
          role="alert"
          className="mt-1 text-xs text-hq-fg-muted"
        >
          {loadFailedLabel}{" "}
          <button
            type="button"
            onClick={onRetry}
            className="text-hq-accent hover:underline"
          >
            {retryLabel}
          </button>
        </p>
      ) : null}
    </div>
  );
}
