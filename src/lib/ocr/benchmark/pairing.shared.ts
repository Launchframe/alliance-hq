import type { OcrTarget } from "./types.shared";

export type OcrPairingMetadata = {
  allianceId: string;
  scoreTarget: OcrTarget;
  fileName: string | null;
  bytes: number | null;
  durationSeconds: number | null;
  sha256?: string | null;
  recordedDate?: string | null;
};

export function suggestSourceMatches(source: OcrPairingMetadata, jobs: Array<OcrPairingMetadata & { id: string }>) {
  return jobs.filter((job) => job.allianceId === source.allianceId && job.scoreTarget === source.scoreTarget)
    .map((job) => {
      const reasons: string[] = [];
      if (source.sha256 && job.sha256 === source.sha256) reasons.push("content_hash");
      if (source.fileName && job.fileName?.normalize("NFC").toLowerCase() === source.fileName.normalize("NFC").toLowerCase()) reasons.push("file_name");
      if (source.bytes != null && source.bytes > 0 && job.bytes === source.bytes) reasons.push("file_size");
      if (source.durationSeconds != null && source.durationSeconds > 0 && job.durationSeconds != null && Math.abs(job.durationSeconds - source.durationSeconds) <= Math.max(0.2, source.durationSeconds * 0.02)) reasons.push("duration");
      if (source.recordedDate && job.recordedDate === source.recordedDate) reasons.push("recorded_date");
      return { jobId: job.id, score: reasons.length + (reasons.includes("content_hash") ? 10 : 0), reasons, requiresConfirmation: true as const };
    })
    .filter((suggestion) => suggestion.score > 0)
    .sort((a, b) => b.score - a.score || a.jobId.localeCompare(b.jobId))
    .slice(0, 20);
}
