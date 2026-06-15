"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { PairingPurpose } from "@/lib/credential-pairing/types";

type PairingCreateResponse = {
  code: string;
  linkUrl: string;
  expiresAt: string;
  purpose: PairingPurpose;
  error?: string;
};

type PairingStatusResponse = {
  status: "pending" | "linked" | "expired" | "invalid";
  linkedAt?: string;
};

export type PairingErrorReason = "expired" | "invalid" | "create_failed";

export type PairingWizardStrings = {
  showQr: string;
  generating: string;
  scanHint: string;
  expiresIn: string;
  expired: string;
  linked: string;
  createFailed: string;
  hideQr: string;
};

type Props = {
  purpose: PairingPurpose;
  createBody?: Record<string, unknown>;
  onLinked?: () => void;
  onError?: (reason: PairingErrorReason) => void;
  onHide?: () => void;
  autoStart?: boolean;
  strings: PairingWizardStrings;
};

function secondsRemaining(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PairingQrWizard({
  purpose,
  createBody,
  onLinked,
  onError,
  onHide,
  autoStart = false,
  strings,
}: Props) {
  const [active, setActive] = useState(autoStart);
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState<PairingCreateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PairingStatusResponse["status"] | null>(
    null,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const linkedRef = useRef(false);
  const errorNotifiedRef = useRef(false);

  const notifyError = useCallback(
    (reason: PairingErrorReason) => {
      if (errorNotifiedRef.current) return;
      errorNotifiedRef.current = true;
      onError?.(reason);
    },
    [onError],
  );

  const reset = useCallback(() => {
    setActive(false);
    setPairing(null);
    setError(null);
    setStatus(null);
    linkedRef.current = false;
    errorNotifiedRef.current = false;
    onHide?.();
  }, [onHide]);

  const startPairing = useCallback(async () => {
    setCreating(true);
    setError(null);
    setStatus(null);
    linkedRef.current = false;
    errorNotifiedRef.current = false;

    try {
      const res = await fetch("/api/pairing/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose,
          ...(createBody ? { metadata: createBody } : {}),
        }),
      });
      const data = (await res.json()) as PairingCreateResponse;
      if (!res.ok) {
        throw new Error(data.error ?? strings.createFailed);
      }
      setPairing(data);
      setActive(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : strings.createFailed;
      setError(message);
      notifyError("create_failed");
    } finally {
      setCreating(false);
    }
  }, [createBody, notifyError, purpose, strings.createFailed]);

  useEffect(() => {
    if (!autoStart) return;
    const id = window.setTimeout(() => {
      void startPairing();
    }, 0);
    return () => window.clearTimeout(id);
  }, [autoStart, startPairing]);

  useEffect(() => {
    if (!active || !pairing) return;

    const tick = window.setInterval(() => {
      const nextNow = Date.now();
      setNowMs(nextNow);
      if (linkedRef.current || errorNotifiedRef.current) return;
      const rem = secondsRemaining(pairing.expiresAt, nextNow);
      if (rem <= 0) {
        notifyError("expired");
      }
    }, 1000);

    return () => window.clearInterval(tick);
  }, [active, notifyError, pairing]);

  const remaining =
    pairing && active ? secondsRemaining(pairing.expiresAt, nowMs) : 0;

  useEffect(() => {
    if (!active || !pairing || linkedRef.current || remaining <= 0) return;

    let cancelled = false;

    const poll = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/pairing/status?code=${encodeURIComponent(pairing.code)}`,
          );
          const data = (await res.json()) as PairingStatusResponse;
          if (cancelled) return;

          if (data.status === "linked" && !linkedRef.current) {
            linkedRef.current = true;
            setStatus("linked");
            onLinked?.();
            return;
          }

          if (data.status === "expired" || data.status === "invalid") {
            setStatus(data.status);
            notifyError(data.status);
          }
        } catch {
          // keep polling until expiry
        }
      })();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [active, notifyError, onLinked, pairing, remaining]);

  const showExpired =
    status === "expired" ||
    status === "invalid" ||
    (pairing && active && remaining <= 0);
  const showLinked = status === "linked";

  return (
    <div className="space-y-3">
      {!active && !autoStart ? (
        <button
          type="button"
          onClick={() => void startPairing()}
          disabled={creating}
          className="w-full rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm font-medium text-[#e6edf3] hover:bg-[#30363d] disabled:opacity-50 sm:w-auto"
        >
          {creating ? strings.generating : strings.showQr}
        </button>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {active && pairing ? (
        <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4">
          {showLinked ? (
            <p className="text-sm text-[#3fb950]">{strings.linked}</p>
          ) : showExpired ? (
            <div className="space-y-3">
              <p className="text-sm text-[#8b949e]">{strings.expired}</p>
              <button
                type="button"
                onClick={() => void startPairing()}
                disabled={creating}
                className="rounded-lg bg-[#238636] px-4 py-2 text-sm font-medium text-white hover:bg-[#2ea043] disabled:opacity-50"
              >
                {strings.showQr}
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={pairing.linkUrl} size={180} level="M" />
              </div>
              <div className="min-w-0 space-y-2 text-sm text-[#8b949e]">
                <p>{strings.scanHint}</p>
                <p>
                  {strings.expiresIn}{" "}
                  <span className="font-mono text-[#e6edf3]">
                    {formatCountdown(remaining)}
                  </span>
                </p>
              </div>
            </div>
          )}

          {!showLinked && !showExpired ? (
            <button
              type="button"
              onClick={reset}
              className="mt-4 text-sm text-[#8b949e] underline hover:text-[#e6edf3]"
            >
              {strings.hideQr}
            </button>
          ) : null}

          {showLinked ? (
            <button
              type="button"
              onClick={reset}
              className="mt-3 rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
            >
              {strings.hideQr}
            </button>
          ) : null}
        </div>
      ) : null}

      {creating && autoStart && !pairing ? (
        <p className="text-sm text-[#8b949e]">{strings.generating}</p>
      ) : null}
    </div>
  );
}
