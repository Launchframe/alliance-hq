export type VideoJobRow = {
  id: string;
  status: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  category: string | null;
  scoreTarget?: string | null;
  frameCount: number | null;
  uploadedFrameCount: number | null;
  parseSessionId?: string | null;
  errorMessage: string | null;
  createdAt: string;
  /** Set when a processor approves the job to run OCR. */
  approvedAt?: string | null;
  /**
   * Set when a processor rejects a pending upload (discarded without approval).
   * Derived from updatedAt until a dedicated column exists.
   */
  rejectedAt?: string | null;
  surveyComplete?: boolean;
};
