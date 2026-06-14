import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class MockS3Client {
    send = send;
  },
  PutObjectCommand: class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  GetObjectCommand: class GetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class DeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

import {
  frameStorageKey,
  r2Configured,
  prefersLocalStorage,
  videoStorageKey,
} from "@/lib/storage/index";
import {
  deleteR2Object,
  getR2Object,
  putR2Object,
  resetR2ClientForTests,
} from "@/lib/storage/r2";

const baseEnv = { ...process.env };

beforeEach(() => {
  send.mockReset();
  resetR2ClientForTests();
  process.env = { ...baseEnv };
});

afterEach(() => {
  process.env = { ...baseEnv };
  resetR2ClientForTests();
});

describe("storage keys", () => {
  it("builds video and frame storage keys", () => {
    expect(videoStorageKey("job1", "clip.MOV")).toBe("videos/job1/source.MOV");
    expect(videoStorageKey("job1", "clip")).toBe("videos/job1/source.mp4");
    expect(frameStorageKey("job1", 3)).toBe("videos/job1/frames/0003.jpg");
  });
});

describe("r2Configured", () => {
  it("requires all R2 env vars", () => {
    process.env.R2_BUCKET = "bucket";
    expect(r2Configured()).toBe(false);

    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    expect(r2Configured()).toBe(true);
  });
});

describe("prefersLocalStorage", () => {
  it("uses local storage when R2 is not configured", () => {
    delete process.env.R2_BUCKET;
    expect(prefersLocalStorage()).toBe(true);
  });
});

describe("R2 object helpers", () => {
  it("throws when R2 is not configured", async () => {
    delete process.env.R2_BUCKET;
    await expect(putR2Object("key", Buffer.from("x"))).rejects.toThrow(
      "R2 is not configured",
    );
  });

  it("uploads, reads, and deletes objects", async () => {
    process.env.R2_BUCKET = "bucket";
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";

    send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: async () => Uint8Array.from([1, 2, 3]),
        },
      })
      .mockResolvedValueOnce({});

    await putR2Object("videos/job/source.mp4", Buffer.from("video"));
    const body = await getR2Object("videos/job/source.mp4");
    await deleteR2Object("videos/job/source.mp4");

    expect(body.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("throws when R2 object body is missing", async () => {
    process.env.R2_BUCKET = "bucket";
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";

    send.mockResolvedValueOnce({ Body: undefined });

    await expect(getR2Object("missing/key")).rejects.toThrow(
      "R2 object not found",
    );
  });
});

describe("local filesystem storage", () => {
  it("writes, reads, and deletes local objects when R2 is unset", async () => {
    delete process.env.R2_BUCKET;
    const { putObject, getObject, deleteObject } = await import(
      "@/lib/storage/index"
    );
    const key = `tests/local-${Date.now()}.txt`;

    await putObject(key, Buffer.from("hello"));
    await expect(getObject(key)).resolves.toEqual(Buffer.from("hello"));
    await deleteObject(key);
    await expect(getObject(key)).rejects.toThrow();
  });
});

describe("index R2 routing", () => {
  it("delegates to R2 when configured", async () => {
    process.env.R2_BUCKET = "bucket";
    process.env.R2_ACCOUNT_ID = "acct";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";

    send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Body: {
          transformToByteArray: async () => Uint8Array.from([9]),
        },
      })
      .mockResolvedValueOnce({});

    const { putObject, getObject, deleteObject } = await import(
      "@/lib/storage/index"
    );
    await putObject("videos/test.txt", Buffer.from("data"));
    await expect(getObject("videos/test.txt")).resolves.toEqual(
      Buffer.from([9]),
    );
    await deleteObject("videos/test.txt");
  });
});
