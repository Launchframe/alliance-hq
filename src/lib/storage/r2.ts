import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

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

export async function deleteR2Object(storageKey: string): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({
      Bucket: bucket(),
      Key: storageKey,
    }),
  );
}

/** @internal test helper */
export function resetR2ClientForTests() {
  client = null;
}
