"use client";

import * as React from "react";

export function AdminDetailField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-subtle">
        {label}
      </p>
      <div className="mt-1 text-sm text-hq-fg">{children}</div>
    </div>
  );
}

export function AdminStatusPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-hq-pill-border bg-hq-pill px-2 py-0.5 text-xs text-hq-pill-fg">
      {children}
    </span>
  );
}

export function AdminFeedbackMasterDetail({
  table,
  detail,
}: {
  table: React.ReactNode;
  detail: React.ReactNode | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      {table}
      {detail}
    </div>
  );
}

export function AdminFeedbackDetailPanel({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-xl border border-hq-border bg-hq-surface p-4 lg:max-h-[min(80vh,720px)] lg:overflow-y-auto">
      {children}
    </div>
  );
}

export function AdminFeedbackTableShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-hq-border">
      <table className="min-w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function AdminMetadataBlock({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <dl className="grid gap-2 rounded-lg border border-hq-border bg-hq-canvas p-3 text-xs">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
          <dt className="text-hq-fg-subtle">{item.label}</dt>
          <dd className="min-w-0 break-words text-hq-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AdminConsoleLogsBlock({ logs }: { logs: string | null }) {
  if (!logs?.trim()) return null;
  return (
    <AdminDetailField label="Console logs">
      <pre className="max-h-48 overflow-auto rounded-lg border border-hq-border bg-hq-canvas p-3 font-mono text-xs text-hq-fg whitespace-pre-wrap break-words">
        {logs}
      </pre>
    </AdminDetailField>
  );
}
