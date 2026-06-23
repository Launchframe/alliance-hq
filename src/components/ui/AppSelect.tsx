"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type AppSelectOption = {
  value: string;
  label: React.ReactNode;
  /** Case-insensitive substring filter text; defaults to string `label`. */
  searchText?: string;
  disabled?: boolean;
};

export type AppSelectOptionGroup = {
  label: string;
  options: AppSelectOption[];
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options?: AppSelectOption[];
  groups?: AppSelectOptionGroup[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  noSearchResultsLabel?: string;
  id?: string;
  name?: string;
  className?: string;
  triggerClassName?: string;
  "aria-label"?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function flattenOptions(
  options: AppSelectOption[] | undefined,
  groups: AppSelectOptionGroup[] | undefined,
): AppSelectOption[] {
  if (groups?.length) {
    return groups.flatMap((group) => group.options);
  }
  return options ?? [];
}

export function appSelectOptionSearchText(option: AppSelectOption): string {
  if (option.searchText?.trim()) {
    return option.searchText.trim();
  }
  return typeof option.label === "string" ? option.label : "";
}

/** Case-insensitive substring match for searchable AppSelect menus. */
export function appSelectOptionMatchesQuery(
  option: AppSelectOption,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return appSelectOptionSearchText(option).toLowerCase().includes(needle);
}

function filterOptionsByQuery(
  options: AppSelectOption[],
  query: string,
): AppSelectOption[] {
  if (!query.trim()) {
    return options;
  }
  return options.filter((option) => appSelectOptionMatchesQuery(option, query));
}

const defaultTriggerClass =
  "flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-left text-sm text-[#e6edf3] transition-colors hover:bg-[#161b22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] disabled:cursor-not-allowed disabled:opacity-50";

export function AppSelect({
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled = false,
  searchable = false,
  searchPlaceholder = "Search…",
  noSearchResultsLabel = "No matches.",
  id,
  name,
  className,
  triggerClassName,
  "aria-label": ariaLabel,
}: Props) {
  const listboxId = React.useId();
  const searchInputId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState<number>(-1);
  const [menuRect, setMenuRect] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const flatOptions = React.useMemo(
    () => flattenOptions(options, groups),
    [groups, options],
  );
  const visibleOptions = React.useMemo(
    () =>
      searchable ? filterOptionsByQuery(flatOptions, searchQuery) : flatOptions,
    [flatOptions, searchQuery, searchable],
  );
  const enabledOptions = visibleOptions.filter((option) => !option.disabled);
  const selectedOption = flatOptions.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? placeholder ?? "";

  const updateMenuRect = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    };
  }, []);

  function closeMenu() {
    setOpen(false);
    setActiveIndex(-1);
    setSearchQuery("");
  }

  React.useEffect(() => {
    if (!open || !searchable) return;
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, searchable]);

  React.useEffect(() => {
    if (!searchable) return;
    const id = window.requestAnimationFrame(() => {
      setActiveIndex(enabledOptions.length > 0 ? 0 : -1);
    });
    return () => window.cancelAnimationFrame(id);
  }, [enabledOptions.length, searchQuery, searchable]);

  React.useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`[data-app-select-menu="${listboxId}"]`)
      ) {
        return;
      }
      closeMenu();
    }

    function isScrollInsideMenu(event: Event) {
      const target = event.target;
      return (
        target instanceof Element &&
        target.closest(`[data-app-select-menu="${listboxId}"]`) !== null
      );
    }

    function handleScroll(event: Event) {
      if (isScrollInsideMenu(event)) return;
      const next = updateMenuRect();
      if (next) setMenuRect(next);
    }

    function handleResize() {
      const next = updateMenuRect();
      if (next) setMenuRect(next);
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [listboxId, open, updateMenuRect]);

  function selectOption(option: AppSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    closeMenu();
    triggerRef.current?.focus();
  }

  function openMenu() {
    if (disabled) return;
    setMenuRect(updateMenuRect());
    setOpen(true);
    const currentIndex = enabledOptions.findIndex(
      (option) => option.value === value,
    );
    setActiveIndex(currentIndex >= 0 ? currentIndex : 0);
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((current) => {
        if (enabledOptions.length === 0) return -1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next =
          current < 0
            ? event.key === "ArrowDown"
              ? 0
              : enabledOptions.length - 1
            : (current + delta + enabledOptions.length) %
              enabledOptions.length;
        return next;
      });
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const option = enabledOptions[activeIndex];
      if (option) selectOption(option);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }

  function renderOption(option: AppSelectOption) {
    const isSelected = option.value === value;
    const isActive = enabledOptions[activeIndex]?.value === option.value;

    return (
      <li key={option.value} role="none">
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          disabled={option.disabled}
          className={cn(
            "flex w-full min-w-0 items-center gap-2 px-3 py-2.5 text-left text-sm",
            option.disabled
              ? "cursor-not-allowed text-[#484f58]"
              : "text-[#e6edf3] hover:bg-[#21262d]",
            isSelected && "bg-[#1f3d5c] text-[#58a6ff]",
            isActive && !isSelected && "bg-[#21262d]",
          )}
          onMouseEnter={() => {
            const index = enabledOptions.findIndex(
              (entry) => entry.value === option.value,
            );
            if (index >= 0) setActiveIndex(index);
          }}
          onClick={() => selectOption(option)}
        >
          <Check
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0",
              isSelected ? "opacity-100" : "opacity-0",
            )}
          />
          <span className="min-w-0 flex-1 wrap-break-word">{option.label}</span>
        </button>
      </li>
    );
  }

  const menu =
    open && menuRect && typeof document !== "undefined"
      ? createPortal(
          <div
            data-app-select-menu={listboxId}
            style={{
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
            }}
            className="fixed z-[300] max-h-60 overflow-hidden rounded-lg border border-[#30363d] bg-[#161b22] shadow-lg"
          >
            {searchable ? (
              <div className="border-b border-[#30363d] p-2">
                <input
                  ref={searchInputRef}
                  id={searchInputId}
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      closeMenu();
                      triggerRef.current?.focus();
                      return;
                    }
                    if (event.key === "ArrowDown" && enabledOptions.length > 0) {
                      event.preventDefault();
                      setActiveIndex(0);
                    }
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                  placeholder={searchPlaceholder}
                  aria-controls={listboxId}
                  className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-2.5 py-2 text-sm text-[#e6edf3] placeholder:text-[#6e7681] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
                  autoComplete="off"
                  aria-label={searchPlaceholder}
                />
              </div>
            ) : null}
            <ul
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              className="max-h-48 overflow-y-auto py-1"
            >
              {groups?.length && !searchable
                ? groups.map((group) => (
                    <li key={group.label} role="none">
                      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6e7681]">
                        {group.label}
                      </div>
                      <ul role="group" aria-label={group.label}>
                        {group.options.map((option) => renderOption(option))}
                      </ul>
                    </li>
                  ))
                : null}
              {!groups?.length || searchable
                ? visibleOptions.length > 0
                  ? visibleOptions.map((option) => renderOption(option))
                  : (
                    <li
                      role="none"
                      className="px-3 py-2 text-sm text-[#8b949e]"
                    >
                      {noSearchResultsLabel}
                    </li>
                  )
                : null}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={cn("relative w-full min-w-0", className)}>
      {name ? (
        <input type="hidden" name={name} value={value} readOnly />
      ) : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(defaultTriggerClass, triggerClassName)}
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          openMenu();
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !selectedOption && placeholder ? "text-[#8b949e]" : undefined,
          )}
        >
          {selectedLabel}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-[#8b949e] transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {menu}
    </div>
  );
}
