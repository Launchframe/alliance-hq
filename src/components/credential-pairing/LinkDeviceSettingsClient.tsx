"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { LinkedDevicesSettings } from "@/components/credential-pairing/LinkedDevicesSettings";
import { PairingQrWizard } from "@/components/credential-pairing/PairingQrWizard";
import { Link } from "@/i18n/navigation";
import { strongText } from "@/components/i18n/richText";

type Props = {
  isConnected: boolean;
};

export function LinkDeviceSettingsClient({ isConnected }: Props) {
  const t = useTranslations("deviceLink");
  const [linkedDevicesRefresh, setLinkedDevicesRefresh] = useState(0);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">{t("pageSubtitle")}</p>
      </div>

      <div className="rounded-lg border border-[#d29922]/40 bg-[#d29922]/10 px-4 py-3">
        <p className="font-medium text-[#e3b341]">{t("multiDeviceHint.title")}</p>
        <p className="mt-2 text-sm text-hq-fg-muted">
          {t.rich("multiDeviceHint.body", { strong: strongText })}
        </p>
      </div>

      <section className="rounded-xl border border-hq-border bg-hq-surface p-5">
        <h2 className="font-medium">{t("sectionTitle")}</h2>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("sectionBody")}</p>
        <p className="mt-2 text-sm text-hq-fg-muted">{t("storageNote")}</p>

        {isConnected ? (
          <div className="mt-4">
            <PairingQrWizard
              purpose="device_link"
              onLinked={() => setLinkedDevicesRefresh((value) => value + 1)}
              strings={{
                showQr: t("showQr"),
                generating: t("generating"),
                scanHint: t("scanHint"),
                desktopLinkHint: t("desktopLinkHint"),
                copyLinkLabel: t("copyLinkLabel"),
                expiresIn: t("expiresIn"),
                expired: t("expired"),
                linked: t("linked"),
                createFailed: t("createFailed"),
                hideQr: t("hideQr"),
              }}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-hq-fg-muted">{t("needsConnectionBody")}</p>
            <Link
              href="/connect?next=/settings/link-device"
              className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
            >
              {t("needsConnectionCta")}
            </Link>
          </div>
        )}

        <LinkedDevicesSettings refreshToken={linkedDevicesRefresh} />
      </section>
    </div>
  );
}
