import { NextResponse } from "next/server";

import { processRosterLinkActionToken } from "@/lib/member-link/roster-link-request.server";

function renderHtml(result: {
  title: string;
  body: string;
  ok: boolean;
  redirectUrl?: string;
}): string {
  const accent = result.ok ? "#238636" : "#da3633";
  const redirectMeta = result.redirectUrl
    ? `<meta http-equiv="refresh" content="2;url=${escapeHtml(result.redirectUrl)}" />`
    : "";
  const redirectLink = result.redirectUrl
    ? `<p style="margin-top:1rem;"><a href="${escapeHtml(result.redirectUrl)}" style="color:#58a6ff;">Continue in Alliance HQ</a></p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${redirectMeta}
  <title>${escapeHtml(result.title)} — Alliance HQ</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; margin: 0; padding: 2rem; }
    main { max-width: 32rem; margin: 0 auto; border: 1px solid #30363d; border-radius: 12px; padding: 1.5rem; }
    h1 { font-size: 1.25rem; margin: 0 0 0.75rem; color: ${accent}; }
    p { margin: 0; line-height: 1.5; color: #8b949e; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(result.title)}</h1>
    <p>${escapeHtml(result.body)}</p>
    ${redirectLink}
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() ?? "";

  const result = await processRosterLinkActionToken(token);

  return new NextResponse(renderHtml(result), {
    status: result.ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
