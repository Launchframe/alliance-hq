"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function disconnect() {
    setLoading(true);
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
      setLoading(false);
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
        <h2 className="font-medium">Ashed connection</h2>
        <p className="mt-2 text-sm text-[#8b949e]">
          Disconnecting clears your stored connection key from our server. You
          can reconnect anytime using the setup walkthrough.
        </p>
        <button
          type="button"
          onClick={() => void disconnect()}
          disabled={loading}
          className="mt-4 rounded-lg border border-[#f85149] px-4 py-2 text-sm text-[#f85149] hover:bg-[#f8514920] disabled:opacity-50"
        >
          {loading ? "Disconnecting…" : "Disconnect Ashed"}
        </button>
        {message && <p className="mt-3 text-sm text-[#f85149]">{message}</p>}
      </section>

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
