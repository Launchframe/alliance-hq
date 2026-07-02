/** Client-safe queue row shape for /tools/video-upload/queue. */
export type AllianceQueueJob = {
  id: string;
  status: string;
  fileName: string | null;
  scoreTarget: string | null;
  boardKey: string | null;
  enqueuedBy: string | null;
  createdAt: string;
  frameCount: number | null;
  uploadedFrameCount: number | null;
  errorMessage: string | null;
};
