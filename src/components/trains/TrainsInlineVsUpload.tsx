"use client";

import { VideoUploadForm } from "@/components/VideoUploadForm";
import { buildConnectHref } from "@/lib/connect/connect-return-path.shared";
import { buildTrainsScoresReadyReturnPath } from "@/lib/trains/guided-video-upload.shared";

export function TrainsInlineVsUpload({
  trainDate,
  recordedDate,
  canProcess,
  ashedConnected,
  memberName = null,
}: {
  trainDate: string;
  recordedDate: string | null;
  canProcess: boolean;
  ashedConnected: boolean;
  memberName?: string | null;
}) {
  const returnTo = buildTrainsScoresReadyReturnPath(trainDate);
  return (
    <VideoUploadForm
      embedded
      initialJobs={[]}
      memberName={memberName}
      contextScoreTarget="vs-performance"
      contextRecordedDate={recordedDate}
      contextReturnTo={returnTo}
      canProcess={canProcess}
      ashedConnected={ashedConnected}
      connectUrl={buildConnectHref(returnTo)}
    />
  );
}
