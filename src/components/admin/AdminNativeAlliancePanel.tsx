"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { CopyToClipboardField } from "@/components/ui/CopyToClipboardField";

function isValidInviteEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export type NativeAllianceOption = {
  id: string;
  slug: string;
  name: string;
};

type Props = {
  nativeAlliances: NativeAllianceOption[];
  selectedAllianceId: string;
  onSelectAlliance: (allianceId: string) => void;
  onCreated: () => void;
};

export function AdminNativeAlliancePanel({
  nativeAlliances,
  selectedAllianceId,
  onSelectAlliance,
  onCreated,
}: Props) {
  const t = useTranslations("admin.nativeAlliance");
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRedirectPath, setInviteRedirectPath] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "officer">("officer");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function createAlliance() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/native-alliances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          tag,
          ownerEmail: ownerEmail.trim() || undefined,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        alliance?: { allianceId: string; tag: string; name: string };
      };
      if (!res.ok) throw new Error(body.error ?? t("createFailed"));
      if (body.alliance?.allianceId) {
        onSelectAlliance(body.alliance.allianceId);
      }
      setMessage(
        t("created", {
          name: body.alliance?.name ?? name,
          tag: body.alliance?.tag ?? tag,
        }),
      );
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  const inviteEmailValid = isValidInviteEmail(inviteEmail);

  async function sendInvite() {
    if (!selectedAllianceId.trim()) {
      setError(t("chooseAllianceRequired"));
      return;
    }
    if (!inviteEmailValid) {
      setError(t("inviteEmailRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/native-alliances/${encodeURIComponent(selectedAllianceId.trim())}/invites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: inviteEmail,
            roleName: inviteRole,
            redirectPath: inviteRedirectPath.trim() || undefined,
          }),
        },
      );
      const body = (await res.json()) as {
        error?: string;
        invite?: { inviteUrl: string };
      };
      if (!res.ok) throw new Error(body.error ?? t("inviteFailed"));
      setLastInviteUrl(body.invite?.inviteUrl ?? null);
      setMessage(t("inviteSent"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inviteFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6 rounded-xl border border-[#30363d] bg-[#161b22] p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[#8b949e]">{t("tag")}</span>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="text-[#8b949e]">{t("ownerEmailOptional")}</span>
          <input
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void createAlliance()}
        className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {t("createButton")}
      </button>

      <div className="border-t border-[#30363d] pt-4">
        <h3 className="text-sm font-semibold">{t("inviteTitle")}</h3>
        <p className="mt-1 text-sm text-[#8b949e]">{t("inviteTargetHint")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("chooseAlliance")}</span>
            <AppSelect
              value={selectedAllianceId}
              onChange={onSelectAlliance}
              placeholder={t("chooseAlliancePlaceholder")}
              aria-label={t("chooseAlliance")}
              disabled={nativeAlliances.length === 0}
              options={nativeAlliances.map((alliance) => ({
                value: alliance.id,
                label: `${alliance.slug} — ${alliance.name}`,
              }))}
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("inviteEmail")}</span>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
              autoComplete="email"
            />
            <span className="block text-xs text-[#6e7681]">
              {t("inviteEmailHint")}
            </span>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-[#8b949e]">{t("inviteRole")}</span>
            <select
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as "owner" | "officer")
              }
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2"
            >
              <option value="owner">{t("roleOwner")}</option>
              <option value="officer">{t("roleOfficer")}</option>
            </select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("inviteRedirectOptional")}</span>
            <input
              type="text"
              value={inviteRedirectPath}
              onChange={(e) => setInviteRedirectPath(e.target.value)}
              placeholder="/trains"
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 font-mono text-sm"
            />
            <span className="block text-xs text-[#6e7681]">
              {t("inviteRedirectHint")}
            </span>
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !selectedAllianceId || !inviteEmailValid}
          onClick={() => void sendInvite()}
          className="mt-3 rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
        >
          {t("inviteButton")}
        </button>
        {lastInviteUrl ? (
          <CopyToClipboardField
            className="mt-3"
            label={t("inviteLinkLabel")}
            value={lastInviteUrl}
          />
        ) : null}
      </div>

      {message ? <p className="text-sm text-[#3fb950]">{message}</p> : null}
      {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
    </section>
  );
}
