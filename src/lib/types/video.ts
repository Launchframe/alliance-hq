export type VideoJobRow = {
  id: string;
  status: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  category: string | null;
  frameCount: number | null;
  uploadedFrameCount: number | null;
  errorMessage: string | null;
  createdAt: string;
};
