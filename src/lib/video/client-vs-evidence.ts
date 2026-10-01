import { MAX_SCREENSHOT_UPLOAD_BYTES } from "@/lib/ocr/screenshot-upload.shared";
import type {
  VsVideoContext,
  VsVideoEvidenceResponse,
  VsVideoRequestedKind,
} from "@/lib/vs-performance/video-evidence.shared";

export class VsVideoClientError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
    this.name = "VsVideoClientError";
  }
}

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg"]);

function basePath(jobId: string) {
  return `/api/tools/video-upload/${encodeURIComponent(jobId)}/vs-evidence`;
}

function codeFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const code = (body as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error) return error;
  }
  return fallback;
}

async function parseResponse(response: Response, fallback = "request_failed") {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new VsVideoClientError(codeFrom(body, fallback), response.status);
  }
  return body;
}

async function apiFetch(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(path, { ...init, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new VsVideoClientError("network");
  }
  return response;
}

export async function getVsVideoEvidence(
  jobId: string,
  signal?: AbortSignal,
): Promise<VsVideoEvidenceResponse> {
  const response = await apiFetch(basePath(jobId), { method: "GET" }, signal);
  return (await parseResponse(response)) as VsVideoEvidenceResponse;
}

export async function patchVsVideoEvidence(
  jobId: string,
  body: {
    expectedVersion: number;
    context?: VsVideoContext;
    requestedKind?: VsVideoRequestedKind;
    draft?: unknown;
  },
  signal?: AbortSignal,
): Promise<VsVideoEvidenceResponse> {
  const response = await apiFetch(
    basePath(jobId),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    signal,
  );
  return (await parseResponse(response)) as VsVideoEvidenceResponse;
}

export async function uploadVsVideoScreenshot(
  jobId: string,
  file: File,
  expectedVersion: number,
  requestedKind: VsVideoRequestedKind = "auto",
  signal?: AbortSignal,
): Promise<VsVideoEvidenceResponse> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new VsVideoClientError("invalid_file_type");
  }
  if (file.size <= 0 || file.size > MAX_SCREENSHOT_UPLOAD_BYTES) {
    throw new VsVideoClientError("invalid_file_size");
  }
  const init = (await parseResponse(
    await apiFetch(
      basePath(jobId),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion,
          fileName: file.name,
          fileSize: file.size,
          contentType: file.type,
          requestedKind,
        }),
      },
      signal,
    ),
  )) as {
    mode: "r2_put" | "direct";
    putUrl?: string;
    imageVersion: number;
    contentType: string;
  };
  if (init.mode === "r2_put") {
    if (typeof init.putUrl !== "string") {
      throw new VsVideoClientError("invalid_upload");
    }
    const put = await apiFetch(
      init.putUrl,
      {
        method: "PUT",
        headers: { "Content-Type": init.contentType || file.type },
        body: file,
      },
      signal,
    );
    if (!put.ok) {
      throw new VsVideoClientError("upload_failed", put.status);
    }
  } else {
    const put = await apiFetch(
      `${basePath(jobId)}/upload?imageVersion=${init.imageVersion}`,
      {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      },
      signal,
    );
    if (!put.ok) {
      const body = await put.json().catch(() => null);
      throw new VsVideoClientError(
        codeFrom(body, "upload_failed"),
        put.status,
      );
    }
  }
  const complete = await apiFetch(
    `${basePath(jobId)}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageVersion: init.imageVersion }),
    },
    signal,
  );
  return (await parseResponse(complete)) as VsVideoEvidenceResponse;
}

export async function removeVsVideoScreenshot(
  jobId: string,
  expectedVersion: number,
  signal?: AbortSignal,
): Promise<VsVideoEvidenceResponse> {
  const response = await apiFetch(
    basePath(jobId),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion }),
    },
    signal,
  );
  return (await parseResponse(response)) as VsVideoEvidenceResponse;
}

export async function processVsVideoEvidence(
  jobId: string,
  signal?: AbortSignal,
): Promise<VsVideoEvidenceResponse> {
  const response = await apiFetch(
    `${basePath(jobId)}/process`,
    { method: "POST" },
    signal,
  );
  return (await parseResponse(response)) as VsVideoEvidenceResponse;
}

export async function saveVsVideoMatch(
  jobId: string,
  body: { requestId: string; submission: unknown },
  signal?: AbortSignal,
): Promise<VsVideoEvidenceResponse> {
  const response = await apiFetch(
    `${basePath(jobId)}/save`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    signal,
  );
  return (await parseResponse(response)) as VsVideoEvidenceResponse;
}

export async function syncVsVideoEvidence(
  jobId: string,
  target: "scores" | "matchup",
  signal?: AbortSignal,
): Promise<VsVideoEvidenceResponse> {
  const response = await apiFetch(
    `${basePath(jobId)}/sync`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    },
    signal,
  );
  return (await parseResponse(response)) as VsVideoEvidenceResponse;
}

export type { VsVideoContext };
