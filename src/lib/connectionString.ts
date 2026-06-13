/** Default Base44 app backing ashed.online */
export const DEFAULT_APP_ID = "692b7e16a524fdd9dff3332d";
export const DEFAULT_ORIGIN_URL = "https://ashed.online";
export const CONNECTION_STRING_SCHEME = "base44";

export type ParsedConnection = {
  appId: string;
  token: string;
  originUrl: string;
};

export type ParseResult =
  | { ok: true; connection: ParsedConnection }
  | { ok: false; error: string };

function trimBearer(value: string): string {
  const trimmed = value.trim();
  if (/^bearer\s+/i.test(trimmed)) {
    return trimmed.replace(/^bearer\s+/i, "").trim();
  }
  return trimmed;
}

function looksLikeJwt(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

function parseFromCurl(input: string): Partial<ParsedConnection> | null {
  if (!/curl\s/i.test(input) && !/-H\s/i.test(input)) {
    return null;
  }

  const out: Partial<ParsedConnection> = {};

  const authMatch = input.match(
    /-H\s+['"]authorization:\s*Bearer\s+([^'"]+)['"]/i,
  );
  if (authMatch?.[1]) {
    out.token = authMatch[1].trim();
  }

  const originMatch = input.match(/-H\s+['"]x-origin-url:\s*([^'"]+)['"]/i);
  if (originMatch?.[1]) {
    out.originUrl = originMatch[1].trim();
  }

  const appIdHeader = input.match(/-H\s+['"]x-app-id:\s*([^'"]+)['"]/i);
  if (appIdHeader?.[1]) {
    out.appId = appIdHeader[1].trim();
  }

  const appsPath = input.match(/base44\.app\/api\/apps\/([a-f0-9]+)/i);
  if (appsPath?.[1]) {
    out.appId = appsPath[1];
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function formatConnectionString(connection: ParsedConnection): string {
  const params = new URLSearchParams();
  params.set("origin", connection.originUrl);
  params.set("token", connection.token);
  return `${CONNECTION_STRING_SCHEME}://${connection.appId}?${params.toString()}`;
}

export function maskConnectionString(connectionString: string): string {
  try {
    const parsed = parseConnectionString(connectionString);
    if (!parsed.ok) {
      return connectionString.slice(0, 24) + "…";
    }
    const { connection } = parsed;
    const tokenPreview =
      connection.token.length > 12
        ? `${connection.token.slice(0, 8)}…${connection.token.slice(-4)}`
        : "…";
    return `${CONNECTION_STRING_SCHEME}://${connection.appId}?origin=${connection.originUrl}&token=${tokenPreview}`;
  } catch {
    return "base44://…";
  }
}

export function parseConnectionString(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Connection string is empty." };
  }

  if (!trimmed.startsWith(`${CONNECTION_STRING_SCHEME}://`)) {
    return parseConnectionInput(trimmed);
  }

  try {
    const withoutScheme = trimmed.slice(`${CONNECTION_STRING_SCHEME}://`.length);
    const qIndex = withoutScheme.indexOf("?");
    const appId = qIndex === -1 ? withoutScheme : withoutScheme.slice(0, qIndex);
    const query = qIndex === -1 ? "" : withoutScheme.slice(qIndex + 1);

    if (!appId) {
      return { ok: false, error: "Connection string is missing an app id." };
    }

    const params = new URLSearchParams(query);
    const token = params.get("token")?.trim();
    const originUrl = params.get("origin")?.trim() || DEFAULT_ORIGIN_URL;

    if (!token) {
      return { ok: false, error: "Connection string is missing a token." };
    }

    return {
      ok: true,
      connection: { appId, token, originUrl },
    };
  } catch {
    return { ok: false, error: "Could not parse connection string URL." };
  }
}

export function parseConnectionInput(
  input: string,
  defaults?: Partial<ParsedConnection>,
): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste a token or connection string." };
  }

  const baseDefaults: ParsedConnection = {
    appId: defaults?.appId ?? DEFAULT_APP_ID,
    originUrl: defaults?.originUrl ?? DEFAULT_ORIGIN_URL,
    token: defaults?.token ?? "",
  };

  if (trimmed.startsWith(`${CONNECTION_STRING_SCHEME}://`)) {
    return parseConnectionString(trimmed);
  }

  const fromCurl = parseFromCurl(trimmed);
  if (fromCurl) {
    const token = fromCurl.token;
    if (!token) {
      return {
        ok: false,
        error: "Found a curl command but no authorization Bearer token.",
      };
    }
    return {
      ok: true,
      connection: {
        appId: fromCurl.appId ?? baseDefaults.appId,
        originUrl: fromCurl.originUrl ?? baseDefaults.originUrl,
        token,
      },
    };
  }

  if (/^authorization:\s*/i.test(trimmed)) {
    const token = trimBearer(trimmed.replace(/^authorization:\s*/i, ""));
    if (!looksLikeJwt(token)) {
      return {
        ok: false,
        error: "Authorization header does not look like a JWT.",
      };
    }
    return {
      ok: true,
      connection: { ...baseDefaults, token },
    };
  }

  const bearerToken = trimBearer(trimmed);
  if (looksLikeJwt(bearerToken)) {
    return {
      ok: true,
      connection: { ...baseDefaults, token: bearerToken },
    };
  }

  return {
    ok: false,
    error:
      "Paste a base44:// connection string, a Bearer token, an authorization header line, or a curl command.",
  };
}
