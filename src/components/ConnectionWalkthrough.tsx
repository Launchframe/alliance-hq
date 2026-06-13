"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
  formatConnectionString,
  maskConnectionString,
  parseConnectionInput,
  type ParsedConnection,
} from "@/lib/connectionString";
import { Kbd, KbdCombo, KbdOr } from "@/components/ui/Kbd";
import { ConnectStepScreenshot } from "@/components/ConnectStepScreenshot";
import {
  COPY_CONNECT_METHOD_CHECKLISTS,
  COPY_CONNECT_METHOD_TITLES,
  CopyConnectMethodStep,
  type CopyConnectMethod,
} from "@/components/CopyConnectMethodStep";
import { TokenExpiryNotice } from "@/components/TokenExpiryNotice";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import {
  DEFAULT_EXPIRY_REMINDER_DAYS,
  formatTokenExpiryDate,
  getJwtExpiryDate,
} from "@/lib/jwt/decode";

type WalkthroughStep = {
  id: string;
  title: string;
  body: React.ReactNode;
  checklist?: string;
};

const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: "login",
    title: "Log into ashed.online",
    body: (
      <>
        <p>
          Open{" "}
          <a
            href="https://ashed.online"
            target="_blank"
            rel="noreferrer"
            className="text-[#58a6ff] hover:underline"
          >
            ashed.online
          </a>{" "}
          in another tab and sign in with the same account you use for alliance
          data.
        </p>
        <p className="mt-2 text-sm text-[#8b949e]">
          Your connection key carries the same access as that logged-in browser
          tab. We store it encrypted on our server — not in your browser.
        </p>
      </>
    ),
    checklist: "I am logged into ashed.online",
  },
  {
    id: "devtools-network",
    title: "Open Network in DevTools",
    body: (
      <>
        <p>
          With ashed.online still open, open your browser&apos;s developer tools
          and click the <strong>Network</strong> tab.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
          <li>
            <strong>Open DevTools — Mac:</strong>{" "}
            <KbdOr
              options={[
                <Kbd key="f12">F12</Kbd>,
                <KbdCombo key="mac" keys={["⌥", "⌘", "I"]} />,
              ]}
            />
          </li>
          <li>
            <strong>Windows / Linux:</strong>{" "}
            <KbdOr
              options={[
                <Kbd key="f12">F12</Kbd>,
                <KbdCombo key="win" keys={["Ctrl", "Shift", "I"]} />,
              ]}
            />
          </li>
        </ul>
        <p className="mt-3 text-sm text-[#8b949e]">
          If the request list is empty, refresh the page or open{" "}
          <strong>Reports</strong>. Optional: filter by{" "}
          <code className="rounded bg-[#0d1117] px-1.5 py-0.5 font-mono text-[0.9em]">
            base44
          </code>
          .
        </p>
        <ConnectStepScreenshot
          src="/help/connect/2-open-network-tab.png"
          alt="Ashed alliances page with Chrome DevTools open on the Network tab, filtered by base44"
          caption="Network tab selected, recording on, filter set to base44"
        />
      </>
    ),
    checklist: "Network tab is open and showing requests",
  },
  {
    id: "copy-curl",
    title: COPY_CONNECT_METHOD_TITLES.curl,
    body: null,
    checklist: COPY_CONNECT_METHOD_CHECKLISTS.curl,
  },
  {
    id: "paste",
    title: "Paste and connect",
    body: null,
    checklist: "Ready to connect",
  },
];

function getCopyMethodLabels(method: CopyConnectMethod) {
  return {
    title: COPY_CONNECT_METHOD_TITLES[method],
    checklist: COPY_CONNECT_METHOD_CHECKLISTS[method],
  };
}

function getStepTitle(step: WalkthroughStep, copyMethod: CopyConnectMethod) {
  if (step.id === "copy-curl") {
    return getCopyMethodLabels(copyMethod).title;
  }
  return step.title;
}

function getStepChecklist(
  step: WalkthroughStep,
  copyMethod: CopyConnectMethod,
) {
  if (step.id === "copy-curl") {
    return getCopyMethodLabels(copyMethod).checklist;
  }
  return step.checklist;
}

type Props = {
  onConnected?: (connection: ParsedConnection) => void;
};

export function ConnectionWalkthrough({ onConnected }: Props) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [pasteInput, setPasteInput] = useState("");
  const [originUrl, setOriginUrl] = useState(DEFAULT_ORIGIN_URL);
  const [appId, setAppId] = useState(DEFAULT_APP_ID);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectSuccess, setConnectSuccess] = useState<{
    ashed: AshedConnectionMeta;
    userLabel: string;
  } | null>(null);
  const [copyMethod, setCopyMethod] = useState<CopyConnectMethod>("curl");

  const step = WALKTHROUGH_STEPS[stepIndex];
  const isPasteStep = step.id === "paste";
  const isCopyStep = step.id === "copy-curl";
  const stepTitle = getStepTitle(step, copyMethod);
  const stepChecklist = getStepChecklist(step, copyMethod);

  const changeStep = useCallback((updater: (index: number) => number) => {
    setStepIndex((index) => {
      const nextIndex = updater(index);
      if (
        WALKTHROUGH_STEPS[index]?.id === "copy-curl" &&
        nextIndex !== index
      ) {
        setCopyMethod("curl");
      }
      return nextIndex;
    });
  }, []);

  const parsePreview = useMemo(() => {
    if (!pasteInput.trim()) return null;
    return parseConnectionInput(pasteInput, { appId, originUrl });
  }, [pasteInput, appId, originUrl]);

  const previewExpiry = useMemo(() => {
    if (!parsePreview?.ok) return null;
    const exp = getJwtExpiryDate(parsePreview.connection.token);
    if (!exp) return null;
    return formatTokenExpiryDate(exp);
  }, [parsePreview]);

  const previewConnectionString =
    parsePreview?.ok ? formatConnectionString(parsePreview.connection) : null;

  const canAdvance = !stepChecklist || checked[step.id] || isPasteStep;

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);

    const parsed = parseConnectionInput(pasteInput, { appId, originUrl });
    if (!parsed.ok) {
      setError(parsed.error);
      setConnecting(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: pasteInput,
          appId,
          originUrl,
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        ok?: boolean;
        userLabel?: string;
        ashed?: AshedConnectionMeta;
      };

      if (!res.ok) {
        setError(data.error ?? "Connection failed");
        return;
      }

      if (data.ashed && data.userLabel) {
        setConnectSuccess({ ashed: data.ashed, userLabel: data.userLabel });
        onConnected?.(parsed.connection);
        return;
      }

      onConnected?.(parsed.connection);
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  }, [appId, onConnected, originUrl, pasteInput, router]);

  if (connectSuccess) {
    const { ashed, userLabel } = connectSuccess;
    return (
      <div className="mx-auto max-w-2xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-[#3fb950]">
            Connected to Ashed
          </h1>
          <p className="mt-2 text-[#8b949e]">
            Signed in as{" "}
            <strong className="text-[#e6edf3]">{userLabel}</strong>.
          </p>
        </header>

        <section className="space-y-4 rounded-xl border border-[#30363d] bg-[#161b22] p-5 text-sm">
          {ashed.tokenExpiresAtFormatted ? (
            <TokenExpiryNotice
              formattedDate={ashed.tokenExpiresAtFormatted}
              reminderDays={
                ashed.expiryReminderDays ?? DEFAULT_EXPIRY_REMINDER_DAYS
              }
            />
          ) : (
            <p className="text-[#8b949e]">
              Connected, but we couldn&apos;t read an expiry date from this
              token. We&apos;ll still notify you if Ashed stops accepting it.
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              router.push("/");
              router.refresh();
            }}
            className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
          >
            Continue to Alliance HQ
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Connect your Ashed account</h1>
        <p className="mt-2 text-[#8b949e]">
          Alliance HQ uses{" "}
          <a
            href="https://ashed.online"
            target="_blank"
            rel="noreferrer"
            className="text-[#58a6ff] hover:underline"
          >
            ashed.online
          </a>{" "}
          for alliance data. You&apos;ll copy one network request as a cURL
          command — we handle the rest.
        </p>
      </header>

      <ol className="mb-4 flex flex-wrap gap-2" aria-label="Setup progress">
        {WALKTHROUGH_STEPS.map((s, i) => (
          <li
            key={s.id}
            className={`flex items-center gap-1.5 text-xs ${
              i === stepIndex
                ? "text-[#e6edf3]"
                : i < stepIndex
                  ? "text-[#3fb950]"
                  : "text-[#8b949e]"
            }`}
          >
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full border text-[0.65rem] ${
                i === stepIndex
                  ? "border-[#58a6ff] bg-[#1f3d5c]"
                  : i < stepIndex
                    ? "border-[#238636]"
                    : "border-[#30363d] bg-[#21262d]"
              }`}
            >
              {i + 1}
            </span>
            <span className="hidden sm:inline">
              {i === stepIndex && s.id === "copy-curl"
                ? stepTitle
                : s.title}
            </span>
          </li>
        ))}
      </ol>

      <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="text-lg font-medium">{stepTitle}</h2>
        {isCopyStep && (
          <div className="mt-3 text-sm">
            <CopyConnectMethodStep
              method={copyMethod}
              onMethodChange={setCopyMethod}
            />
          </div>
        )}
        {!isPasteStep && !isCopyStep && step.body && (
          <div className="mt-3 text-sm">{step.body}</div>
        )}

        {isPasteStep && (
          <div className="mt-3 space-y-4 text-sm">
            <p>
              Paste your <strong>Copy as cURL</strong> command here (recommended).
              We also accept a Bearer token, authorization header line, or full
              connection string.
            </p>

            <label className="block">
              <span className="mb-1 block text-xs text-[#8b949e]">Paste here</span>
              <textarea
                rows={8}
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
                placeholder={`curl 'https://base44.app/api/apps/…' \\\n  -H 'authorization: Bearer eyJhbGci…' \\\n  -H 'x-origin-url: https://ashed.online' …`}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-[#8b949e]">App id</span>
                <input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-[#8b949e]">
                  Origin URL
                </span>
                <input
                  value={originUrl}
                  onChange={(e) => setOriginUrl(e.target.value)}
                  className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
                />
              </label>
            </div>

            {parsePreview && !parsePreview.ok && (
              <p className="text-sm text-[#f85149]">{parsePreview.error}</p>
            )}

            {previewConnectionString && (
              <div>
                <span className="text-xs text-[#8b949e]">Preview</span>
                <pre className="mt-1 overflow-x-auto rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs">
                  {maskConnectionString(previewConnectionString)}
                </pre>
                {previewExpiry && (
                  <p className="mt-2 text-xs text-[#8b949e]">
                    Token expires{" "}
                    <strong className="text-[#e6edf3]">{previewExpiry}</strong>{" "}
                    (from JWT)
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {stepChecklist && !isPasteStep && (
          <label className="mt-4 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked[step.id] ?? false}
              onChange={(e) =>
                setChecked((prev) => ({ ...prev, [step.id]: e.target.checked }))
              }
              className="mt-1"
            />
            {stepChecklist}
          </label>
        )}

        {error && <p className="mt-4 text-sm text-[#f85149]">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => changeStep((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
            className="rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm disabled:opacity-50"
          >
            Back
          </button>
          {!isPasteStep ? (
            <button
              type="button"
              onClick={() => changeStep((i) => i + 1)}
              disabled={!canAdvance}
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting || !parsePreview?.ok}
              className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
