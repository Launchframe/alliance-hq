import type { ParsedConnection } from "@/lib/connectionString";
import { DEFAULT_APP_ID } from "@/lib/connectionString";

export function appApiUrl(connection: ParsedConnection, path: string): string {
  const appId = connection.appId || DEFAULT_APP_ID;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `https://base44.app/api/apps/${appId}${normalized}`;
}

export function authHeaders(connection: ParsedConnection): Record<string, string> {
  return {
    Authorization: `Bearer ${connection.token}`,
    "X-Origin-Url": connection.originUrl,
  };
}

export async function base44Json<T>(
  connection: ParsedConnection,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(appApiUrl(connection, path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(connection),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Base44 ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export async function base44UploadFile(
  connection: ParsedConnection,
  fileName: string,
  contentType: string,
  buffer: Buffer,
): Promise<{ file_url: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
  form.append("file", blob, fileName);

  const res = await fetch(
    appApiUrl(connection, "/integration-endpoints/Core/UploadFile"),
    {
      method: "POST",
      headers: authHeaders(connection),
      body: form,
    },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`UploadFile failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as { file_url: string };
}

export async function base44ExtractData(
  connection: ParsedConnection,
  fileUrl: string,
  jsonSchema: Record<string, unknown>,
): Promise<unknown> {
  return base44Json(connection, "/integration-endpoints/Core/ExtractDataFromUploadedFile", {
    method: "POST",
    body: JSON.stringify({ file_url: fileUrl, json_schema: jsonSchema }),
  });
}

export async function base44ListMembers(
  connection: ParsedConnection,
  allianceId: string,
): Promise<
  Array<{
    id: string;
    current_name: string;
    previous_names?: string[];
    alliance_id?: string;
    status?: string;
  }>
> {
  if (!allianceId) {
    throw new Error("allianceId is required to list members.");
  }
  const path = `/entities/Member?q=${encodeURIComponent(JSON.stringify({ alliance_id: allianceId }))}&sort=current_name`;
  const rows = await base44Json<
    Array<{
      id: string;
      current_name: string;
      previous_names?: string[];
      alliance_id?: string;
      status?: string;
    }>
  >(connection, path, {
    method: "GET",
  });

  const hasAllianceField = rows.some((member) => member.alliance_id);
  if (hasAllianceField) {
    return rows.filter((member) => member.alliance_id === allianceId);
  }

  return rows;
}

export type AshedAlliance = {
  id: string;
  tag?: string;
  name?: string;
  owner_id?: string;
  owner_email?: string;
  collaborators?: string[];
};

export async function base44ListAlliances(
  connection: ParsedConnection,
): Promise<AshedAlliance[]> {
  return base44Json<AshedAlliance[]>(connection, "/entities/Alliance", {
    method: "GET",
  });
}

export async function base44BulkInsert<T>(
  connection: ParsedConnection,
  entity: string,
  rows: T[],
): Promise<unknown> {
  return base44Json(connection, `/entities/${entity}/bulk`, {
    method: "POST",
    body: JSON.stringify(rows),
  });
}

export async function base44EntityPost<T>(
  connection: ParsedConnection,
  entity: string,
  row: T,
): Promise<unknown> {
  return base44Json(connection, `/entities/${entity}`, {
    method: "POST",
    body: JSON.stringify(row),
  });
}

export async function base44CallFunction<TBody extends Record<string, unknown>, TResult>(
  connection: ParsedConnection,
  name: string,
  body: TBody,
): Promise<TResult> {
  return base44Json<TResult>(connection, `/functions/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
