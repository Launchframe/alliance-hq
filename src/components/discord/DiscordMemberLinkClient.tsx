"use client";

import { useCallback, useState } from "react";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { isValidGameUid } from "@/lib/lastwar/player-lookup";
import type { DiscordMemberLinkWebOutcome } from "@/lib/vr/discord-member-link-web.shared";

type Phase =
  | "form"
  | "confirm"
  | "confirm_home"
  | "fuzzy"
  | "success"
  | "officer"
  | "wrong_server"
  | "position_not_home"
  | "guild_not_registered"
  | "error";

type Props = {
  nonce: string;
  allianceTag: string | null;
  replaceAll: boolean;
  guildRegistered: boolean;
  labels: {
    heading: string;
    subheading: string;
    subheadingColdStart: string;
    playerIdLabel: string;
    playerIdHint: string;
    replaceNote: string;
    continue: string;
    confirmHeading: string;
    confirmServer: string;
    confirmYes: string;
    confirmNo: string;
    fuzzyHeading: string;
    successHeading: string;
    successBody: string;
    officerHeading: string;
    wrongServerHeading: string;
    positionNotHomeHeading: string;
    confirmHomeHeading: string;
    confirmHomeAllianceChoice: string;
    confirmHomeLookupChoice: string;
    guildNotRegisteredHeading: string;
    guildNotRegisteredBody: string;
    backToDiscord: string;
    invalidPlayerId: string;
    genericError: string;
  };
};

export function DiscordMemberLinkClient({
  nonce,
  allianceTag,
  replaceAll,
  guildRegistered,
  labels,
}: Props) {
  const [phase, setPhase] = useState<Phase>("form");
  const [gameUid, setGameUid] = useState("");
  const [gameUserName, setGameUserName] = useState<string | null>(null);
  const [gameServerNumber, setGameServerNumber] = useState<number | null>(null);
  const [homeConfirmAllianceTag, setHomeConfirmAllianceTag] = useState<string | null>(
    null,
  );
  const [homeConfirmLookupServer, setHomeConfirmLookupServer] = useState<number | null>(
    null,
  );
  const [homeConfirmAllianceServer, setHomeConfirmAllianceServer] = useState<
    number | null
  >(null);
  const [candidates, setCandidates] = useState<
    Array<{ memberId: string; name: string }>
  >([]);
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const subheading = guildRegistered ? labels.subheading : labels.subheadingColdStart;

  function renderHeader() {
    return (
      <>
        <h1 className="mb-1 text-lg font-semibold text-hq-fg">{labels.heading}</h1>
        {phase === "form" ? (
          <p className="mb-5 text-sm text-hq-fg-muted">{subheading}</p>
        ) : (
          <div className="mb-5" />
        )}
      </>
    );
  }

  const applyOutcome = useCallback((data: DiscordMemberLinkWebOutcome) => {
    switch (data.outcome) {
      case "confirm_identity":
        setGameUserName(data.gameUserName);
        setGameServerNumber(data.gameServerNumber);
        setPhase("confirm");
        setFormError(null);
        break;
      case "confirm_home_server":
        setGameUserName(data.gameUserName);
        setMessage(data.message);
        setHomeConfirmAllianceTag(data.allianceTag);
        setHomeConfirmLookupServer(data.lookupServerNumber);
        setHomeConfirmAllianceServer(data.allianceServerNumber);
        setPhase("confirm_home");
        setFormError(null);
        break;
      case "fuzzy_pick":
        setMessage(data.message);
        setCandidates(data.candidates);
        setPhase("fuzzy");
        break;
      case "linked":
        setLinkedName(data.memberDisplayName);
        setMessage(data.message);
        setPhase("success");
        break;
      case "officer_attention":
        setMessage(data.message);
        setPhase("officer");
        break;
      case "wrong_server":
        setMessage(data.message);
        setPhase("wrong_server");
        break;
      case "position_not_home":
        setMessage(data.message);
        setPhase("position_not_home");
        break;
      case "guild_not_registered":
        setPhase("guild_not_registered");
        break;
      case "declined":
        setGameUid("");
        setGameUserName(null);
        setPhase("form");
        setFormError(data.message);
        break;
      case "error":
      default:
        setPhase("error");
        setMessage(data.message);
        break;
    }
  }, []);

  async function postAction(body: Record<string, unknown>) {
    const res = await fetch("/api/discord/link-commander", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as DiscordMemberLinkWebOutcome & {
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      setPhase("error");
      setMessage(
        data.outcome === "error"
          ? data.message
          : (data.message ?? data.error ?? labels.genericError),
      );
      return;
    }
    applyOutcome(data);
  }

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = gameUid.trim();
    if (!isValidGameUid(trimmed)) {
      setFormError(labels.invalidPlayerId);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await postAction({ action: "preview", nonce, gameUid: trimmed });
    } catch {
      setPhase("error");
      setMessage(labels.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(answer: "yes" | "no") {
    setBusy(true);
    try {
      await postAction({ action: "confirm", nonce, answer });
    } catch {
      setPhase("error");
      setMessage(labels.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmHome(choice: "alliance" | "lookup") {
    setBusy(true);
    try {
      await postAction({ action: "confirm_home", nonce, choice });
    } catch {
      setPhase("error");
      setMessage(labels.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function handlePick(memberId: string) {
    setBusy(true);
    try {
      await postAction({ action: "pick", nonce, memberId });
    } catch {
      setPhase("error");
      setMessage(labels.genericError);
    } finally {
      setBusy(false);
    }
  }

  if (phase === "success") {
    return (
      <div className="space-y-3 text-center">
        {renderHeader()}
        <p className="text-lg font-semibold text-hq-fg">{labels.successHeading}</p>
        {linkedName ? (
          <p className="text-sm text-hq-fg-muted">
            {labels.successBody.replace("{name}", linkedName)}
          </p>
        ) : null}
        <p className="text-sm text-hq-fg-muted">{labels.backToDiscord}</p>
      </div>
    );
  }

  if (phase === "position_not_home") {
    return (
      <div className="space-y-3">
        {renderHeader()}
        <p className="font-semibold text-hq-fg">{labels.positionNotHomeHeading}</p>
        {message ? <p className="text-sm text-hq-fg-muted">{message}</p> : null}
        <p className="text-sm text-hq-fg-muted">{labels.backToDiscord}</p>
      </div>
    );
  }

  if (phase === "wrong_server") {
    return (
      <div className="space-y-3">
        {renderHeader()}
        <p className="font-semibold text-hq-fg">{labels.wrongServerHeading}</p>
        {message ? <p className="text-sm text-hq-fg-muted">{message}</p> : null}
        <p className="text-sm text-hq-fg-muted">{labels.backToDiscord}</p>
      </div>
    );
  }

  if (phase === "guild_not_registered") {
    return (
      <div className="space-y-3">
        {renderHeader()}
        <p className="font-semibold text-hq-fg">{labels.guildNotRegisteredHeading}</p>
        <p className="text-sm text-hq-fg-muted">{labels.guildNotRegisteredBody}</p>
        <p className="text-sm text-hq-fg-muted">{labels.backToDiscord}</p>
      </div>
    );
  }

  if (phase === "officer" || phase === "error") {
    return (
      <div className="space-y-3">
        {renderHeader()}
        <p className="font-semibold text-hq-fg">
          {phase === "officer" ? labels.officerHeading : labels.genericError}
        </p>
        {message ? <p className="text-sm text-hq-fg-muted">{message}</p> : null}
        <p className="text-sm text-hq-fg-muted">{labels.backToDiscord}</p>
      </div>
    );
  }

  if (phase === "confirm_home" && gameUserName) {
    const tag = homeConfirmAllianceTag ?? allianceTag ?? "alliance";
    return (
      <div className="space-y-4">
        {renderHeader()}
        <p className="text-sm text-hq-fg-muted">
          {message ?? labels.confirmHomeHeading}
        </p>
        <p className="text-lg font-semibold text-hq-fg">{gameUserName}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirmHome("lookup")}
            className="rounded-lg border border-hq-border px-4 py-2.5 text-sm font-semibold text-hq-fg disabled:opacity-60"
          >
            {labels.confirmHomeLookupChoice.replace(
              "{server}",
              String(homeConfirmLookupServer ?? ""),
            )}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirmHome("alliance")}
            className="rounded-lg bg-hq-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {labels.confirmHomeAllianceChoice
              .replace("{tag}", tag)
              .replace("{server}", String(homeConfirmAllianceServer ?? ""))}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "confirm" && gameUserName) {
    return (
      <div className="space-y-4">
        {renderHeader()}
        <p className="text-sm text-hq-fg-muted">{labels.confirmHeading}</p>
        <p className="text-lg font-semibold text-hq-fg">{gameUserName}</p>
        {gameServerNumber != null ? (
          <p className="text-sm text-hq-fg-muted">
            {labels.confirmServer.replace("{server}", String(gameServerNumber))}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm("yes")}
            className="rounded-lg bg-hq-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {labels.confirmYes}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm("no")}
            className="rounded-lg border border-hq-border px-4 py-2.5 text-sm font-semibold text-hq-fg disabled:opacity-60"
          >
            {labels.confirmNo}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "fuzzy") {
    return (
      <div className="space-y-4">
        {renderHeader()}
        {message ? <p className="text-sm text-hq-fg-muted">{message}</p> : null}
        <p className="text-sm font-medium text-hq-fg">{labels.fuzzyHeading}</p>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.memberId}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handlePick(c.memberId)}
                className="w-full rounded-lg border border-hq-border px-4 py-2.5 text-left text-sm font-medium text-hq-fg hover:bg-hq-surface-raised disabled:opacity-60"
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        preventDefaultFormSubmit(event);
        void handlePreview(event);
      }}
      className="space-y-4"
    >
      {renderHeader()}
      {allianceTag ? (
        <p className="text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
          {allianceTag}
        </p>
      ) : null}
      {replaceAll ? (
        <p className="text-sm text-hq-fg-muted">{labels.replaceNote}</p>
      ) : null}
      <div>
        <label htmlFor="discord-member-link-uid" className="mb-1 block text-sm font-medium text-hq-fg">
          {labels.playerIdLabel}
        </label>
        <input
          id="discord-member-link-uid"
          name="gameUid"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
          value={gameUid}
          onChange={(e) => setGameUid(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded-lg border border-hq-border bg-hq-bg px-3 py-2.5 font-mono text-sm text-hq-fg"
          maxLength={16}
        />
        <p className="mt-1.5 text-xs text-hq-fg-muted">{labels.playerIdHint}</p>
      </div>
      {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-hq-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
      >
        {labels.continue}
      </button>
    </form>
  );
}
