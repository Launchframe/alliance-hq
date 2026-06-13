"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { TokenExpiryNotice } from "@/components/TokenExpiryNotice";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import { DEFAULT_EXPIRY_REMINDER_DAYS } from "@/lib/jwt/decode";
import { ASHED_LOGOUT_WARNING } from "@/lib/jwt/messages";

const REMINDER_OPTIONS = [7, 14, 21, 30];

type Props = {
  initialAshed: AshedConnectionMeta | null;
};

export function SettingsConnectionForm({ initialAshed }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ashed, setAshed] = useState(initialAshed);
  const [reminderDays, setReminderDays] = useState(
    initialAshed?.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS,
  );

  async function saveReminderDays(days: number) {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiryReminderDays: days }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setMessage(data.error ?? "Could not save reminder preference");
        return;
      }
      const data = (await res.json()) as { ashed: AshedConnectionMeta };
      setAshed(data.ashed);
      setReminderDays(data.ashed.expiryReminderDays);
      setMessage("Reminder preference saved");
    } catch {
      setMessage("Could not save reminder preference");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/disconnect", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setMessage(data.error ?? "Disconnect failed");
        return;
      }
      router.push("/connect");
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-[#8b949e]">
          Manage your Ashed connection and Alliance HQ preferences.
        </p>
      </div>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">Ashed token</h2>
        {ashed?.tokenExpiresAtFormatted ? (
          <div className="mt-3 space-y-4">
            <TokenExpiryNotice
              formattedDate={ashed.tokenExpiresAtFormatted}
              reminderDays={reminderDays}
            />
            <label className="block text-sm">
              <span className="mb-2 block text-[#8b949e]">
                Remind me
              </span>
              <select
                value={reminderDays}
                onChange={(e) => {
                  const days = Number(e.target.value);
                  setReminderDays(days);
                  void saveReminderDays(days);
                }}
                disabled={saving}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              >
                {REMINDER_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} days before expiration
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="mt-2 text-sm text-[#8b949e]">
            Reconnect to refresh your token and see its expiration date.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="font-medium">Disconnect</h2>
        <p className="mt-2 text-sm text-[#8b949e]">
          Clears your stored connection key from our server. You can reconnect
          anytime using the setup walkthrough.
        </p>
        <p className="mt-2 text-sm text-[#8b949e]">{ASHED_LOGOUT_WARNING}</p>
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={disconnecting}
          className="mt-4 rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514920] disabled:opacity-50"
        >
          {disconnecting ? "Disconnecting…" : "Disconnect Ashed"}
        </button>
      </section>

      {message && (
        <p
          className={`text-sm ${message.includes("saved") ? "text-[#3fb950]" : "text-[#f85149]"}`}
        >
          {message}
        </p>
      )}

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-sm text-[#8b949e]">
        <p>
          Alliance HQ at{" "}
          <strong className="text-[#e6edf3]">alliance-hq.online</strong> is a
          community wrapper for{" "}
          <a
            href="https://ashed.online"
            target="_blank"
            rel="noreferrer"
            className="text-[#58a6ff] hover:underline"
          >
            ashed.online
          </a>
          . All alliance data credit belongs to Ashed.
        </p>
      </section>
    </div>
  );
}
