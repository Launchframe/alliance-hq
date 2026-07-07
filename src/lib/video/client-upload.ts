export type UploadConfig = {
  mode: "r2" | "direct";
  maxUploadBytes: number;
  multipartThresholdBytes: number;
  multipartPartBytes: number;
  legacyDirectPostMaxBytes: number;
};

export type InitDirectResponse = {
  mode: "direct";
  maxUploadBytes: number;
};

export type InitR2PutResponse = {
  mode: "r2_put";
  jobId: string;
  putUrl: string;
  contentType: string;
};

export type InitR2MultipartResponse = {
  mode: "r2_multipart";
  jobId: string;
  uploadId: string;
  presignedParts: Array<{
    partNumber: number;
    url: string;
    start: number;
    end: number;
  }>;
};

export type InitUploadResponse =
  | InitDirectResponse
  | InitR2PutResponse
  | InitR2MultipartResponse;

export type CompleteUploadResponse = {
  ok: boolean;
  jobId: string;
  status?: string;
  message?: string;
  error?: string;
};

export async function uploadVideoFile(options: {
  file: File;
  scoreTarget: string;
  boardKey?: string;
  hqEventId?: string;
  uploadConfig: UploadConfig;
  onProgress?: (loaded: number, total: number) => void;
  /** Fires once a server-side job row exists (R2 init or direct POST). */
  onJobCreated?: (jobId: string) => void;
}): Promise<{ jobId: string; message: string; status: string }> {
  const { file, scoreTarget, boardKey, uploadConfig, onProgress, onJobCreated } =
    options;

  if (uploadConfig.mode === "direct") {
    const formData = new FormData();
    formData.set("video", file);
    formData.set("scoreTarget", scoreTarget);
    if (boardKey) formData.set("boardKey", boardKey);
    if (options.hqEventId) formData.set("hqEventId", options.hqEventId);

    onProgress?.(0, file.size);
    const res = await fetch("/api/tools/video-upload", {
      method: "POST",
      body: formData,
    });
    const data = (await res.json()) as CompleteUploadResponse & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? "Upload failed");
    }
    onProgress?.(file.size, file.size);
    onJobCreated?.(data.jobId);
    return {
      jobId: data.jobId,
      message: data.message ?? "Video uploaded.",
      status: data.status ?? "pending_approval",
    };
  }

  const initRes = await fetch("/api/tools/video-upload/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type || undefined,
      scoreTarget,
      boardKey: boardKey ?? null,
      hqEventId: options.hqEventId ?? null,
    }),
  });
  const init = (await initRes.json()) as InitUploadResponse & { error?: string };
  if (!initRes.ok) {
    throw new Error(init.error ?? "Upload init failed");
  }

  if (init.mode === "r2_put") {
    onJobCreated?.(init.jobId);
    await putWithProgress(init.putUrl, file, init.contentType, onProgress);
    return completeUpload(init.jobId);
  }

  if (init.mode === "r2_multipart") {
    onJobCreated?.(init.jobId);
    const parts = await uploadMultipartParts(
      file,
      init.presignedParts,
      onProgress,
    );
    return completeUpload(init.jobId, init.uploadId, parts);
  }

  throw new Error("Unexpected upload init mode.");
}

async function completeUpload(
  jobId: string,
  uploadId?: string,
  parts?: Array<{ partNumber: number; etag: string }>,
): Promise<{ jobId: string; message: string; status: string }> {
  const completeRes = await fetch("/api/tools/video-upload/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, uploadId, parts }),
  });
  const complete = (await completeRes.json()) as CompleteUploadResponse & {
    error?: string;
  };
  if (!completeRes.ok) {
    throw new Error(complete.error ?? "Upload complete failed");
  }
  return {
    jobId: complete.jobId,
    message: complete.message ?? "Video uploaded.",
    status: complete.status ?? "pending_approval",
  };
}

async function putWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.(event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.send(file);
  });
}

async function uploadMultipartParts(
  file: File,
  presignedParts: InitR2MultipartResponse["presignedParts"],
  onProgress?: (loaded: number, total: number) => void,
): Promise<Array<{ partNumber: number; etag: string }>> {
  const completed: Array<{ partNumber: number; etag: string }> = [];
  let loadedTotal = 0;

  for (const part of presignedParts) {
    const chunk = file.slice(part.start, part.end + 1);
    const response = await fetch(part.url, {
      method: "PUT",
      body: chunk,
    });
    if (!response.ok) {
      throw new Error(`Part ${part.partNumber} upload failed (${response.status})`);
    }
    const etag = response.headers.get("etag") ?? response.headers.get("ETag");
    if (!etag) {
      throw new Error(`Part ${part.partNumber} missing ETag`);
    }
    completed.push({ partNumber: part.partNumber, etag });
    loadedTotal += chunk.size;
    onProgress?.(loadedTotal, file.size);
  }

  return completed;
}
