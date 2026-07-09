"use client";

import type { ReactNode } from "react";

type ValueType = number | string;
type NameType = number | string;

type TooltipPayloadEntry = {
  name?: NameType;
  value?: ValueType;
  dataKey?: string | number;
  color?: string;
};

type AnalyticsTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: ReactNode;
  formatter?: (
    value: ValueType,
    name: NameType,
    item: TooltipPayloadEntry,
    index: number,
    payload: TooltipPayloadEntry[],
  ) => ReactNode | [ReactNode, NameType];
  labelFormatter?: (
    label: ReactNode,
    payload: TooltipPayloadEntry[],
  ) => ReactNode;
};

function AnalyticsTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
}: AnalyticsTooltipProps) {
  if (!active || !payload?.length) return null;

  const displayLabel =
    labelFormatter && label != null
      ? labelFormatter(label, payload)
      : label;

  const singleItemMatchesLabel =
    payload.length === 1 &&
    displayLabel != null &&
    String(payload[0].name ?? "") === String(displayLabel);

  return (
    <div className="rounded-lg border border-hq-border bg-hq-surface px-3 py-2 text-sm text-hq-fg shadow-md">
      {displayLabel && !singleItemMatchesLabel ? (
        <p className="mb-1 font-medium text-hq-fg">{displayLabel}</p>
      ) : null}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => {
          const rawValue = entry.value;
          const rawName = entry.name ?? entry.dataKey;
          let displayValue: ReactNode = rawValue;
          let displayName: NameType | undefined =
            typeof rawName === "number" || typeof rawName === "string"
              ? rawName
              : undefined;

          if (formatter && rawValue != null && displayName != null) {
            const formatted = formatter(
              rawValue,
              displayName,
              entry,
              index,
              payload,
            );
            if (Array.isArray(formatted)) {
              [displayValue, displayName] = formatted;
            } else {
              displayValue = formatted;
            }
          }

          const showName =
            displayName != null && String(displayName).length > 0;

          return (
            <li
              key={`${String(entry.dataKey)}-${String(displayName)}-${index}`}
              className="flex items-center gap-2 text-hq-fg"
            >
              {entry.color ? (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden
                />
              ) : null}
              <span>
                {showName ? `${displayName}: ` : ""}
                {displayValue}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { AnalyticsTooltipContent };

export const analyticsTooltipProps = {
  content: AnalyticsTooltipContent,
  wrapperStyle: { zIndex: 20 },
} as const;
