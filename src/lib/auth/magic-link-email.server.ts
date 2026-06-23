import "server-only";

type MagicLinkTheme = {
  brandColor?: string;
  buttonText?: string;
};

/** Matches @auth/core default verification email HTML (not re-exported from the package). */
function authVerificationEmailHtml(params: {
  url: string;
  host: string;
  theme: MagicLinkTheme;
}): string {
  const { url, host, theme } = params;
  const escapedHost = host.replace(/\./g, "&#8203;.");
  const brandColor = theme.brandColor || "#346df1";
  const buttonText = theme.buttonText || "#fff";
  const color = {
    background: "#f9f9f9",
    text: "#444",
    mainBackground: "#fff",
    buttonBackground: brandColor,
    buttonBorder: brandColor,
    buttonText,
  };
  return `
<body style="background: ${color.background};">
  <table width="100%" border="0" cellspacing="20" cellpadding="0"
    style="background: ${color.mainBackground}; max-width: 600px; margin: auto; border-radius: 10px;">
    <tr>
      <td align="center"
        style="padding: 10px 0px; font-size: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
        Sign in to <strong>${escapedHost}</strong>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table border="0" cellspacing="0" cellpadding="0">
          <tr>
            <td align="center" style="border-radius: 5px;" bgcolor="${color.buttonBackground}"><a href="${url}"
                target="_blank"
                style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${color.buttonText}; text-decoration: none; border-radius: 5px; padding: 10px 20px; border: 1px solid ${color.buttonBorder}; display: inline-block; font-weight: bold;">Sign
                in</a></td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center"
        style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${color.text};">
        If you did not request this email you can safely ignore it.
      </td>
    </tr>
  </table>
</body>
`;
}

function authVerificationEmailText(params: { url: string; host: string }): string {
  const { url, host } = params;
  return `Sign in to ${host}\n${url}\n\n`;
}

export function shouldLogMagicLinkToStdout(): boolean {
  return process.env.NODE_ENV !== "production";
}

export function isMagicLinkLogOnly(): boolean {
  const flag = process.env.AUTH_MAGIC_LINK_LOG_ONLY?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/** Dev-only: print the sign-in URL to the server console (never log in production). */
export function logMagicLinkToStdout(email: string, url: string): void {
  console.log(
    `\n[alliance-hq] Magic link for ${email} (dev only — do not share in production):\n${url}\n`,
  );
}

export async function sendMagicLinkViaResend(input: {
  to: string;
  url: string;
  from: string;
  apiKey: string | undefined;
  theme: MagicLinkTheme;
}): Promise<void> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const { host } = new URL(input.url);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: input.from,
      to: input.to,
      subject: `Sign in to ${host}`,
      html: authVerificationEmailHtml({ url: input.url, host, theme: input.theme }),
      text: authVerificationEmailText({ url: input.url, host }),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend error: ${JSON.stringify(await res.json())}`);
  }
}
