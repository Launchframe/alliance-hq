import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function r2Configured(): boolean {
  return Boolean(
    process.env.R2_BUCKET &&
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

function requireR2Config() {
  if (!r2Configured()) {
    throw new Error(
      "R2 is not configured. Set R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.",
    );
  }
}

let client: S3Client | null = null;

function getR2Client(): S3Client {
  requireR2Config();
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

function bucket(): string {
  return process.env.R2_BUCKET!;
}

export async function putR2Object(
  storageKey: string,
  body: Buffer | Uint8Array,
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
      Body: body,
    }),
  );
}

export async function getR2Object(storageKey: string): Promise<Buffer> {
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
    }),
  );

  if (!response.Body) {
    throw new Error(`R2 object not found: ${storageKey}`);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function getR2ObjectStream(
  storageKey: string,
): Promise<ReadableStream<Uint8Array>> {
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
    }),
  );

  if (!response.Body) {
    throw new Error(`R2 object not found: ${storageKey}`);
  }

  const body = response.Body as {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    transformToByteArray?: () => Promise<Uint8Array>;
  };

  if (typeof body.transformToWebStream === "function") {
    return body.transformToWebStream();
  }

  if (typeof body.transformToByteArray !== "function") {
    throw new Error(`R2 object body is not streamable: ${storageKey}`);
  }

  const bytes = await body.transformToByteArray();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function headR2ObjectSize(storageKey: string): Promise<number> {
  const response = await getR2Client().send(
    new HeadObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
    }),
  );

  if (response.ContentLength == null) {
    throw new Error(`R2 object size unavailable: ${storageKey}`);
  }

  return response.ContentLength;
}

export async function getR2ObjectRange(
  storageKey: string,
  start: number,
  end: number,
): Promise<Buffer> {
  const response = await getR2Client().send(
    new GetObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
      Range: `bytes=${start}-${end}`,
    }),
  );

  if (!response.Body) {
    throw new Error(`R2 object not found: ${storageKey}`);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteR2Object(storageKey: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
    }),
  );
}

export async function createR2MultipartUpload(
  storageKey: string,
  contentType: string,
): Promise<string> {
  const response = await getR2Client().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: storageKey,
      ContentType: contentType,
    }),
  );
  if (!response.UploadId) {
    throw new Error("R2 did not return an upload id.");
  }
  return response.UploadId;
}

export async function presignR2UploadPart(
  storageKey: string,
  uploadId: string,
  partNumber: number,
  expiresInSeconds = 900,
): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new UploadPartCommand({
      Bucket: bucket(),
      Key: storageKey,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function presignR2PutObject(
  storageKey: string,
  contentType: string,
  expiresInSeconds = 900,
): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export async function presignR2GetObject(
  storageKey: string,
  expiresInSeconds = 604800,
): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
    }),
    { expiresIn: expiresInSeconds },
  );
}

export type R2CompletedPart = {
  partNumber: number;
  etag: string;
};

export async function completeR2MultipartUpload(
  storageKey: string,
  uploadId: string,
  parts: R2CompletedPart[],
): Promise<void> {
  await getR2Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: storageKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({
            ETag: part.etag,
            PartNumber: part.partNumber,
          })),
      },
    }),
  );
}

export async function abortR2MultipartUpload(
  storageKey: string,
  uploadId: string,
): Promise<void> {
  await getR2Client().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: storageKey,
      UploadId: uploadId,
    }),
  );
}

/** @internal test helper */
export function resetR2ClientForTests() {
  client = null;
}
