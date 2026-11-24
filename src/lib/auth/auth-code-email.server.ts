import "server-only";

import type { AppLocale } from "@/i18n/routing";
import { notificationTranslator } from "@/lib/notifications/locale.server";

export type AuthCodeEmailKind = "verify" | "merge" | "emailChange";

export function buildAuthCodeEmail(
  kind: AuthCodeEmailKind,
  code: string,
  locale: AppLocale,
): { subject: string; html: string; text: string } {
  const t = notificationTranslator(locale, "notificationMessages.authCode");
  const html = `
<body style="background: #0d1117; margin: 0; padding: 24px;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0"
    style="max-width: 480px; margin: auto; font-family: Helvetica, Arial, sans-serif;">
    <tr>
      <td style="padding: 24px; background: #161b22; border: 1px solid #30363d; border-radius: 12px;">
        <p style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #e6edf3;">
          ${t(`${kind}.heading`)}
        </p>
        <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.5; color: #8b949e;">
          ${t(`${kind}.body`)}
        </p>
        <p style="margin: 0 0 20px; font-size: 32px; font-weight: 700; letter-spacing: 0.35em; text-align: center; color: #e6edf3;">
          ${code}
        </p>
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #6e7681;">
          ${t("expiry")}
        </p>
      </td>
    </tr>
  </table>
</body>`;
  return {
    subject: t(`${kind}.subject`, { code }),
    html,
    text: t(`${kind}.text`, { code }),
  };
}
