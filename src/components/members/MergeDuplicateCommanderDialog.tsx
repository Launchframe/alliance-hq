"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import {
  isMergeDuplicateErrorCode,
  mergeDuplicateErrorKey,
} from "@/lib/members/merge-duplicate-commander.shared";

type Candidate = { ashedMemberId: string; currentName: string };

type Summary = {
  keptName: string;
  duplicateName: string;
  newName: string;
  oldName: string;
  historyCount: number;
};

type Props = {
  ashedMemberId: string;
  memberName: string;
};

function errorKeyFromBody(body: unknown) {
  const code = (body as { code?: unknown } | null)?.code;
  return mergeDuplicateErrorKey(isMergeDuplicateErrorCode(code) ? code : "generic");
}

export function MergeDuplicateCommanderDialog({ ashedMemberId, memberName }: Props) {
  const t = useTranslations("members.mergeCommander");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<ReturnType<typeof errorKeyFromBody> | null>(
    null,
  );
  const [success, setSuccess] = useState<Summary | null>(null);

  const endpoint = `/api/members/${encodeURIComponent(ashedMemberId)}/merge-duplicate`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = candidates ?? [];
    return q ? list.filter((c) => c.currentName.toLowerCase().includes(q)) : list;
  }, [candidates, query]);

  function reset() {
    setQuery("");
    setSelected(null);
    setPreview(null);
    setErrorKey(null);
  }

  async function openDialog() {
    reset();
    setOpen(true);
    if (candidates) return;
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const body = (await res.json()) as { candidates?: Candidate[] };
      if (!res.ok || !body.candidates) {
        setErrorKey(errorKeyFromBody(body));
        return;
      }
      setCandidates(body.candidates);
    } catch {
      setErrorKey("generic");
    }
  }

  async function choose(candidate: Candidate) {
    setSelected(candidate);
    setPreview(null);
    setErrorKey(null);
    setBusy(true);
    try {
      const res = await fetch(
        `${endpoint}?duplicate=${encodeURIComponent(candidate.ashedMemberId)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as { summary?: Summary };
      if (!res.ok || !body.summary) {
        setErrorKey(errorKeyFromBody(body));
        return;
      }
      setPreview(body.summary);
    } catch {
      setErrorKey("generic");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateAshedMemberId: selected.ashedMemberId }),
      });
      const body = (await res.json()) as { summary?: Summary };
      if (!res.ok || !body.summary) {
        setErrorKey(errorKeyFromBody(body));
        return;
      }
      setSuccess(body.summary);
      setCandidates(null);
      setOpen(false);
      router.refresh();
    } catch {
      setErrorKey("generic");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface"
        data-testid="merge-duplicate-open"
      >
        {t("open")}
      </button>
      {success ? (
        <p className="w-full text-sm text-hq-success" role="status">
          {t("success", { duplicate: success.duplicateName, name: success.newName })}
        </p>
      ) : null}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) setOpen(false);
        }}
        title={t("title", { name: memberName })}
      >
        <div className="flex min-w-0 flex-col gap-4" data-testid="merge-duplicate-dialog">
          <div>
            <h2 className="text-lg font-semibold text-hq-fg">
              {t("title", { name: memberName })}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-hq-fg-muted">
              {t("description", { name: memberName })}
            </p>
          </div>

          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            <span className="font-medium text-hq-fg">{t("pickLabel")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("pickPlaceholder")}
              className="w-full min-w-0 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
              data-testid="merge-duplicate-search"
            />
          </label>

          <ul
            className="max-h-48 min-w-0 overflow-y-auto rounded-lg border border-hq-border"
            role="listbox"
            aria-label={t("pickLabel")}
          >
            {filtered.map((c) => (
              <li key={c.ashedMemberId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.ashedMemberId === c.ashedMemberId}
                  disabled={busy}
                  onClick={() => void choose(c)}
                  className={`w-full truncate px-3 py-2 text-left text-sm hover:bg-hq-surface disabled:opacity-50 ${
                    selected?.ashedMemberId === c.ashedMemberId
                      ? "bg-hq-surface font-medium text-hq-fg"
                      : "text-hq-fg"
                  }`}
                  data-testid="merge-duplicate-candidate"
                >
                  {c.currentName}
                </button>
              </li>
            ))}
          </ul>

          {preview ? (
            <div
              className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
              data-testid="merge-duplicate-preview"
            >
              <p className="font-medium text-hq-fg">{t("previewHeading")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-hq-fg-muted">
                <li>
                  {t("previewName", {
                    newName: preview.newName,
                    oldName: preview.oldName,
                  })}
                </li>
                <li>{t("previewHistory", { count: preview.historyCount })}</li>
                <li>{t("previewRetire", { duplicate: preview.duplicateName })}</li>
              </ul>
              <p className="mt-2 font-medium text-amber-700 dark:text-amber-300">
                {t("irreversible")}
              </p>
            </div>
          ) : null}

          {errorKey ? (
            <p className="text-sm text-hq-danger" role="alert" data-testid="merge-duplicate-error">
              {t(`errors.${errorKey}`)}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={busy || !preview}
              onClick={() => void confirm()}
              className="rounded-lg bg-hq-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              data-testid="merge-duplicate-confirm"
            >
              {t("confirm")}
            </button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
