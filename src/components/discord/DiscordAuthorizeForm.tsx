"use client";

import { useState, type FormEvent } from "react";

import { Link } from "@/i18n/navigation";
import { FORM_SUBMIT_ENTER_KEY_HINT } from "@/lib/client/form-enter-submit.shared";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; tag: string }
  | { status: "error"; message: string };

export function DiscordAuthorizeForm({
  nonce,
  tag,
  labels,
}: {
  nonce: string;
  tag: string;
  labels: {
    tagLabel: string;
    keyLabel: string;
    keyHint: string;
    connectGuideLink: string;
    submit: string;
    submitting: string;
    successHeading: string;
    successBody: string;
    errorPrefix: string;
  };
}) {
  const [connectionKey, setConnectionKey] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "loading" });

    try {
      const res = await fetch("/api/discord/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nonce, connectionKey: connectionKey.trim() }),
      });

      const data = (await res.json()) as {
        error?: string;
        tag?: string;
      };

      if (!res.ok) {
        setState({ status: "error", message: data.error ?? `Error ${res.status}` });
        return;
      }

      setState({
        status: "success",
        tag: data.tag ?? tag,
      });
    } catch {
      setState({ status: "error", message: "Network error — please try again." });
    }
  }

  if (state.status === "success") {
    return (
      <div className="rounded-xl border border-green-700 bg-green-950/40 p-6 text-center">
        <p className="text-lg font-semibold text-green-300">{labels.successHeading}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-green-200">
          {labels.successBody.replace("{tag}", state.tag)}
        </p>
      </div>
    );
  }

  const credentialsReady = connectionKey.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#8b949e]">
          {labels.tagLabel}
        </p>
        <p className="font-mono text-base font-semibold text-[#e6edf3]">{tag}</p>
      </div>

      <div>
        <label
          htmlFor="connection-key"
          className="mb-1 block text-sm font-medium text-[#e6edf3]"
        >
          {labels.keyLabel}
        </label>
        <input
          id="connection-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm text-[#e6edf3] placeholder:text-[#6e7681] focus:border-[#58a6ff] focus:outline-none"
          placeholder="Paste your Ashed connection key"
          value={connectionKey}
          onChange={(e) => setConnectionKey(e.target.value)}
          enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
          required
          disabled={state.status === "loading"}
        />
        <p className="mt-1 text-xs text-[#6e7681]">{labels.keyHint}</p>
        <p className="mt-2 text-xs">
          <Link
            href="/connect"
            className="font-medium text-[#58a6ff] hover:underline"
          >
            {labels.connectGuideLink}
          </Link>
        </p>
      </div>

      {state.status === "error" && (
        <p className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {labels.errorPrefix} {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={state.status === "loading" || !credentialsReady}
        className="w-full rounded-lg bg-[#238636] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.status === "loading" ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
