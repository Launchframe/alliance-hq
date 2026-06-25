"use client";

import { useState, type FormEvent } from "react";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "success";
      purpose: "alliance_credentials" | "user_link";
      tag?: string;
      memberDisplayName?: string;
    }
  | { status: "error"; message: string };

export function DiscordAuthorizeForm({
  nonce,
  tag,
  purpose,
  labels,
}: {
  nonce: string;
  tag: string;
  purpose: "alliance_credentials" | "user_link";
  labels: {
    heading: string;
    tagLabel: string;
    keyLabel: string;
    keyHint: string;
    nameLabel: string;
    nameHint: string;
    uidLabel: string;
    uidHint: string;
    submit: string;
    submitting: string;
    successHeading: string;
    successBody: string;
    userSuccessBody: string;
    errorPrefix: string;
  };
}) {
  const [connectionKey, setConnectionKey] = useState("");
  const [reportedName, setReportedName] = useState("");
  const [gameUid, setGameUid] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ status: "loading" });

    const body =
      purpose === "user_link"
        ? { nonce, reportedName: reportedName.trim(), gameUid: gameUid.trim() }
        : { nonce, connectionKey: connectionKey.trim() };

    try {
      const res = await fetch("/api/discord/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        error?: string;
        tag?: string;
        purpose?: "alliance_credentials" | "user_link";
        memberDisplayName?: string;
      };

      if (!res.ok) {
        setState({ status: "error", message: data.error ?? `Error ${res.status}` });
        return;
      }

      setState({
        status: "success",
        purpose: data.purpose ?? purpose,
        tag: data.tag ?? tag,
        memberDisplayName: data.memberDisplayName,
      });
    } catch {
      setState({ status: "error", message: "Network error — please try again." });
    }
  }

  if (state.status === "success") {
    const body =
      state.purpose === "user_link"
        ? labels.userSuccessBody.replace(
            "{name}",
            state.memberDisplayName ?? "your commander",
          )
        : labels.successBody.replace("{tag}", state.tag ?? tag);

    return (
      <div className="rounded-xl border border-green-700 bg-green-950/40 p-6 text-center">
        <p className="text-lg font-semibold text-green-300">{labels.successHeading}</p>
        <p className="mt-2 whitespace-pre-line text-sm text-green-200">{body}</p>
      </div>
    );
  }

  const userLinkReady =
    purpose === "user_link" &&
    reportedName.trim().length > 0 &&
    gameUid.trim().length > 0;
  const credentialsReady =
    purpose === "alliance_credentials" && connectionKey.trim().length > 0;
  const canSubmit = purpose === "user_link" ? userLinkReady : credentialsReady;

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {purpose === "alliance_credentials" ? (
        <>
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
              required
              disabled={state.status === "loading"}
            />
            <p className="mt-1 text-xs text-[#6e7681]">{labels.keyHint}</p>
          </div>
        </>
      ) : (
        <>
          <div>
            <label
              htmlFor="reported-name"
              className="mb-1 block text-sm font-medium text-[#e6edf3]"
            >
              {labels.nameLabel}
            </label>
            <input
              id="reported-name"
              type="text"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] placeholder:text-[#6e7681] focus:border-[#58a6ff] focus:outline-none"
              placeholder="Copy exactly from your in-game profile"
              value={reportedName}
              onChange={(e) => setReportedName(e.target.value)}
              required
              disabled={state.status === "loading"}
            />
            <p className="mt-1 text-xs text-[#6e7681]">{labels.nameHint}</p>
          </div>

          <div>
            <label
              htmlFor="game-uid"
              className="mb-1 block text-sm font-medium text-[#e6edf3]"
            >
              {labels.uidLabel}
            </label>
            <input
              id="game-uid"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm text-[#e6edf3] placeholder:text-[#6e7681] focus:border-[#58a6ff] focus:outline-none"
              placeholder="12–16 digit player ID"
              value={gameUid}
              onChange={(e) => setGameUid(e.target.value)}
              required
              disabled={state.status === "loading"}
            />
            <p className="mt-1 text-xs text-[#6e7681]">{labels.uidHint}</p>
          </div>
        </>
      )}

      {state.status === "error" && (
        <p className="rounded-lg border border-red-700 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {labels.errorPrefix} {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={state.status === "loading" || !canSubmit}
        className="w-full rounded-lg bg-[#238636] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.status === "loading" ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
