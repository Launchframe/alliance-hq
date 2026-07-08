"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useFormatAccountDateTime } from "@/components/timezone/TimezoneProvider";
import { Dialog } from "@/components/ui/dialog";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { useRouter } from "@/i18n/navigation";
import {
  buildConnectHref,
  stashConnectReturnPath,
} from "@/lib/connect/connect-return-path.shared";
import type { LinkedDeviceSummary } from "@/lib/credential-pairing/linked-devices";

type Props = {
  refreshToken?: number;
};

export function LinkedDevicesSettings({ refreshToken = 0 }: Props) {
  const t = useTranslations("deviceLink.devices");
  const formatWhen = useFormatAccountDateTime();
  const router = useRouter();
  const [devices, setDevices] = useState<LinkedDeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<LinkedDeviceSummary | null>(
    null,
  );
  const [revoking, setRevoking] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});

  const applyDevices = useCallback((nextDevices: LinkedDeviceSummary[]) => {
    setDevices(nextDevices);
    setNameDrafts(
      Object.fromEntries(
        nextDevices.map((device) => [device.id, device.deviceName]),
      ),
    );
  }, []);

  const fetchDevices = useCallback(async (): Promise<LinkedDeviceSummary[]> => {
    const res = await fetch("/api/settings/linked-devices");
    const data = (await res.json()) as {
      error?: string;
      devices?: LinkedDeviceSummary[];
    };
    if (!res.ok) {
      throw new Error(data.error ?? t("loadFailed"));
    }
    return data.devices ?? [];
  }, [t]);

  const reloadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyDevices(await fetchDevices());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [applyDevices, fetchDevices, t]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextDevices = await fetchDevices();
        if (cancelled) return;
        applyDevices(nextDevices);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("loadFailed"));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyDevices, fetchDevices, refreshToken, t]);

  async function saveDeviceName(deviceId: string) {
    const deviceName = nameDrafts[deviceId]?.trim();
    if (!deviceName) {
      setError(t("nameRequired"));
      return;
    }

    setRenamingId(deviceId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/settings/linked-devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("renameFailed"));
      }
      setMessage(t("renamed"));
      await reloadDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("renameFailed"));
    } finally {
      setRenamingId(null);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/settings/linked-devices/${revokeTarget.id}`,
        { method: "DELETE" },
      );
      const data = (await res.json()) as {
        error?: string;
        revokedCurrentSession?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error ?? t("revokeFailed"));
      }
      setRevokeTarget(null);
      if (data.revokedCurrentSession) {
        stashConnectReturnPath("/account");
        router.push(buildConnectHref("/account"));
        router.refresh();
        return;
      }
      setMessage(t("revoked"));
      await reloadDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("revokeFailed"));
    } finally {
      setRevoking(false);
    }
  }

  function formatTimestamp(iso: string | null): string {
    if (!iso) {
      return t("neverAccessed");
    }
    return formatWhen(iso, { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="mt-6 space-y-3 border-t border-hq-border pt-4">
      <div>
        <h3 className="font-medium">{t("listTitle")}</h3>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("listBody")}</p>
      </div>

      {loading ? (
        <p className="text-sm text-hq-fg-muted">{t("loading")}</p>
      ) : devices.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {devices.map((device) => (
            <li
              key={device.id}
              className="rounded-lg border border-hq-border p-3"
            >
              <form
                className="flex flex-wrap items-start justify-between gap-3"
                onSubmit={(event) => {
                  preventDefaultFormSubmit(event);
                  void saveDeviceName(device.id);
                }}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`device-name-${device.id}`}>
                      {t("nameLabel")}
                    </label>
                    <input
                      id={`device-name-${device.id}`}
                      type="text"
                      value={nameDrafts[device.id] ?? device.deviceName}
                      onChange={(event) =>
                        setNameDrafts((current) => ({
                          ...current,
                          [device.id]: event.target.value,
                        }))
                      }
                      enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                      className="min-w-0 flex-1 rounded-md border border-hq-border bg-hq-canvas px-2 py-1 text-sm text-hq-fg"
                    />
                    {device.isCurrentDevice ? (
                      <span className="rounded bg-hq-selected/50 px-2 py-0.5 text-xs text-hq-selected-fg">
                        {t("thisDevice")}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-hq-fg-muted">
                    {device.osLabel ?? t("unknownOs")}
                  </p>
                  <p className="text-xs text-hq-fg-muted">
                    {t("linkedAt", { when: formatTimestamp(device.linkedAt) })}
                  </p>
                  <p className="text-xs text-hq-fg-muted">
                    {t("lastAccessAt", {
                      when: formatTimestamp(device.lastAccessAt),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <button
                    type="submit"
                    disabled={renamingId === device.id}
                    className="rounded-lg border border-hq-border px-3 py-1.5 text-sm hover:bg-hq-surface-muted disabled:opacity-50"
                  >
                    {renamingId === device.id ? t("savingName") : t("saveName")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(device)}
                    className="rounded-lg border border-hq-danger px-3 py-1.5 text-sm text-hq-danger hover:bg-[#f8514920]"
                  >
                    {t("revoke")}
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {message ? <p className="text-sm text-hq-green">{message}</p> : null}

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title={t("revokeTitle")}
      >
        <div className="space-y-4">
          <p className="text-sm text-hq-fg-muted">
            {t("revokeBody", {
              name: revokeTarget?.deviceName ?? "",
            })}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setRevokeTarget(null)}
              className="rounded-lg border border-hq-border px-4 py-2 text-sm"
            >
              {t("cancelRevoke")}
            </button>
            <button
              type="button"
              disabled={revoking}
              onClick={() => void confirmRevoke()}
              className="rounded-lg border border-hq-danger bg-[#f8514920] px-4 py-2 text-sm text-hq-danger disabled:opacity-50"
            >
              {revoking ? t("revoking") : t("confirmRevoke")}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
