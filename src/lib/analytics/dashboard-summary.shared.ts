import type { MainSquadType } from "@/lib/commanders/main-squad.shared";

export type DashboardViewerContext = {
  memberId: string | null;
  memberName: string | null;
  hqLinked: boolean;
  totalHeroPower: number | null;
  mainSquad: MainSquadType | null;
  highestBaseVr: number | null;
};

export type SnapshotRow = {
  recordedDate: string;
  activeMemberCount: number;
  linkedCount: number;
  unlinkedCount: number;
  thpTotal: number | null;
  thpP50: number | null;
  thpP90: number | null;
  thpP99: number | null;
  donationTotal: number | null;
  donationP50: number | null;
  donationP90: number | null;
  donationP99: number | null;
};

export type DashboardTrainStatus =
  | { state: "no_template"; weekStart: string }
  | {
      state: "awaiting_conductor";
      weekStart: string;
      today: string;
      templateType: string;
    }
  | {
      state: "in_progress";
      weekStart: string;
      today: string;
      templateType: string;
      conductorMemberName: string | null;
      vipMemberName: string | null;
      lockedAt: string | null;
    };

export type VideoUploadCoverageTarget = {
  id: string;
  labelKey: string;
  lookbackHours: number;
  satisfied: boolean;
  uploadHref: string;
  weekendOnly?: boolean;
};

export type SquadSummary = {
  aircraft: { count: number; avgThp: number };
  tank: { count: number; avgThp: number };
  missile: { count: number; avgThp: number };
  unreported: { count: number; avgThp: number };
};

export type DashboardSummaryPayload = {
  viewer: DashboardViewerContext;
  inbox: Array<{
    id: string;
    kind: string;
    title: string;
    body: string | null;
    href: string | null;
    scoreTarget: string | null;
    createdAt: string;
  }>;
  attention: {
    rosterLinkRequests: number;
    onboardingReviews: number;
    memberLinkHelp: number;
    rosterVideoUpload: number;
    unrankedMembers: number;
  } | null;
  trainStatus: DashboardTrainStatus;
  videoCoverage: VideoUploadCoverageTarget[];
  squad: {
    summaryBySquad: SquadSummary;
    squadPower: {
      aircraft: number;
      tank: number;
      missile: number;
      unreported: number;
    };
  };
  latestSnapshot: SnapshotRow | null;
  linkProgressSeries: SnapshotRow[];
  thpSeries: SnapshotRow[];
  donationSeries: SnapshotRow[];
  vrAvailable: boolean;
  canManageTrains: boolean;
  canWriteMembers: boolean;
  hasAshedConnection: boolean;
};
