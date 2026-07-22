"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { Link } from "@/i18n/navigation";

type Props = {
  ashedMemberId: string;
  canGift: boolean;
};

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CommanderStoreDonationSection({ ashedMemberId, canGift }: Props) {
  const t = useTranslations("members.profile");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [showRecord, setShowRecord] = useState(false);

  const [amountUsd, setAmountUsd] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(todayIsoDate);
  const [note, setNote] = useState("");
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordMessage, setRecordMessage] = useState<string | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  if (!canGift) return null;

  async function launchStore() {
    setLaunchBusy(true);
    setLaunchError(null);
    try {
      const res = await fetch(`/api/members/${ashedMemberId}/donation-store`);
      const body = (await res.json()) as { url?: string; code?: string; error?: string };
      if (!res.ok || !body.url) {
        if (body.code === "recipient_uid_unavailable") {
          setLaunchError(t("donationUnavailable"));
        } else if (body.code === "donation_store_unavailable") {
          setLaunchError(t("donationStoreUnavailable"));
        } else {
          setLaunchError(body.error ?? t("donationLaunchFailed"));
        }
        return;
      }
      window.open(body.url, "_blank", "noopener,noreferrer");
      setConfirmOpen(false);
      setShowRecord(true);
    } catch {
      setLaunchError(t("donationLaunchFailed"));
    } finally {
      setLaunchBusy(false);
    }
  }

  async function saveReceipt() {
    setRecordBusy(true);
    setRecordError(null);
    setRecordMessage(null);
    try {
      const res = await fetch(`/api/members/${ashedMemberId}/donation-receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsd,
          purchasedAt,
          note: note.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setRecordError(body.error ?? t("recordPurchaseFailed"));
        return;
      }
      setRecordMessage(t("recordPurchaseSaved"));
      setAmountUsd("");
      setNote("");
    } catch {
      setRecordError(t("recordPurchaseFailed"));
    } finally {
      setRecordBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-hq-fg-subtle">
          {t("donateBricks")}
        </h2>
        <Link
          href="/donations/store-spend"
          className="text-sm text-sky-400 hover:underline"
        >
          {t("storeSpendNav")}
        </Link>
      </div>

      {!confirmOpen ? (
        <button
          type="button"
          className="mt-3 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
          onClick={() => {
            setConfirmOpen(true);
            setLaunchError(null);
          }}
        >
          {t("donateBricks")}
        </button>
      ) : (
        <div className="mt-3 space-y-3 rounded-lg border border-hq-border bg-hq-bg/40 p-4">
          <p className="text-sm font-medium text-hq-fg">{t("donationDialogTitle")}</p>
          <p className="text-sm text-hq-fg-muted">{t("donationDialogBody")}</p>
          {launchError ? (
            <p className="text-sm text-red-400" role="alert">
              {launchError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={launchBusy}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
              onClick={() => void launchStore()}
            >
              {launchBusy ? "…" : t("donationDialogConfirm")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface"
              onClick={() => setConfirmOpen(false)}
            >
              {t("donationDialogCancel")}
            </button>
          </div>
        </div>
      )}

      {(showRecord || confirmOpen) && (
        <div className="mt-5 border-t border-hq-border pt-4">
          <h3 className="text-sm font-medium text-hq-fg">{t("recordPurchaseTitle")}</h3>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              preventDefaultFormSubmit(event);
              void saveReceipt();
            }}
          >
            <label className="block text-sm">
              <span className="text-hq-fg-muted">{t("recordPurchaseAmount")}</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amountUsd}
                onChange={(e) => setAmountUsd(e.target.value)}
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-hq-fg"
              />
            </label>
            <label className="block text-sm">
              <span className="text-hq-fg-muted">{t("recordPurchaseDate")}</span>
              <input
                type="date"
                required
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-hq-fg"
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-hq-fg-muted">{t("recordPurchaseNote")}</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-hq-border bg-hq-bg px-3 py-2 text-hq-fg"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={recordBusy}
                className="rounded-lg border border-hq-border px-3 py-2 text-sm font-medium text-hq-fg hover:bg-hq-bg disabled:opacity-60"
              >
                {recordBusy ? "…" : t("recordPurchaseSubmit")}
              </button>
              {recordMessage ? (
                <p className="mt-2 text-sm text-emerald-400">{recordMessage}</p>
              ) : null}
              {recordError ? (
                <p className="mt-2 text-sm text-red-400" role="alert">
                  {recordError}
                </p>
              ) : null}
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
