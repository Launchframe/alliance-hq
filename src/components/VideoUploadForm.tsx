"use client";

import { useState } from "react";

import type { VideoJobRow } from "@/lib/types/video";

const CATEGORIES = [
  { value: "vs", label: "VS / weekly scores" },
  { value: "donations", label: "Donations" },
  { value: "storm", label: "Storm / event" },
  { value: "general", label: "Other" },
];

function formatBytes(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  initialJobs: VideoJobRow[];
};

export function VideoUploadForm({ initialJobs }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("vs");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [jobs, setJobs] = useState(initialJobs);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a video file first.");
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("video", file);
    formData.set("category", category);

    try {
      const res = await fetch("/api/tools/video-upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        jobId?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }

      setSuccess(data.message ?? "Video queued for processing.");
      setFile(null);

      const listRes = await fetch("/api/tools/video-upload");
      if (listRes.ok) {
        const listData = (await listRes.json()) as { jobs: VideoJobRow[] };
        setJobs(listData.jobs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Upload from video</h1>
        <p className="mt-1 text-sm text-[#8b949e]">
          Drop a screen recording from Last War. We will extract scoreboard
          screenshots and send them to Ashed for OCR — same as manual uploads,
          but faster.
        </p>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-xl border border-[#30363d] bg-[#161b22] p-5"
      >
        <label className="block">
          <span className="mb-2 block text-sm text-[#8b949e]">
            What kind of scoreboard is this?
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block">
          <span className="mb-2 block text-sm text-[#8b949e]">Video file</span>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-[#8b949e] file:mr-4 file:rounded-lg file:border-0 file:bg-[#238636] file:px-4 file:py-2 file:text-sm file:text-white"
          />
          <p className="mt-2 text-xs text-[#8b949e]">
            MP4 or MOV, under 3 minutes works best. Max 200 MB for now.
          </p>
        </label>

        {file && (
          <p className="mt-2 text-sm">
            Selected: {file.name} ({formatBytes(file.size)})
          </p>
        )}

        {error && <p className="mt-4 text-sm text-[#f85149]">{error}</p>}
        {success && <p className="mt-4 text-sm text-[#3fb950]">{success}</p>}

        <button
          type="submit"
          disabled={uploading || !file}
          className="mt-4 rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload video"}
        </button>
      </form>

      {jobs.length > 0 && (
        <section className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
          <h2 className="font-medium">Recent uploads</h2>
          <ul className="mt-3 space-y-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{job.fileName ?? job.id}</p>
                  <p className="text-xs text-[#8b949e]">
                    {job.category} · {formatBytes(job.fileSizeBytes)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    job.status === "complete"
                      ? "bg-[#23863633] text-[#3fb950]"
                      : job.status === "failed"
                        ? "bg-[#f8514933] text-[#f85149]"
                        : "bg-[#1f3d5c] text-[#58a6ff]"
                  }`}
                >
                  {job.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
