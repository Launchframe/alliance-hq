/**
 * English copy for My VR — pending maintainer approval before messages/en-US.json.
 * Sonnet: replace imports with useTranslations("myVr") once keys land.
 */
export const MY_VR_COPY = {
  pageTitle: "My VR",
  pageSubtitle: "Track and update your season viral resistance.",
  seasonLabel: "Season {season}",
  postSeasonNotice:
    "The season is over. You reached {maxVr} VR in season {priorSeason}.",
  postSeasonNoticeUnreported:
    "The season is over. Season {priorSeason} has ended.",
  seasonLockedError:
    "The season is over. VR updates are closed until the next season starts.", // matches discordBot.vr.seasonLocked
  currentVrLabel: "Current VR",
  notReportedYet: "Not reported yet",
  tabNow: "Now",
  tabHistory: "History",
  updateVr: "Update VR",
  bumpButton: "Increase by 250",
  setDialogTitle: "Set VR level",
  setDialogDescription: "Enter your current base VR in steps of 250.",
  setLabel: "VR level",
  setSubmit: "Save VR",
  cancel: "Cancel",
  percentileTitle: "Alliance standing",
  percentileToggle: "Show alliance rank",
  percentileRank: "Rank {rank} of {count} reporters",
  percentileAtOrBelow: "{percentile}% of reporters are at or below your VR",
  percentileNotEnough: "Not enough alliance reports yet for a rank.",
  chartPlaceholder:
    "Report your VR at least twice to see your progress over time.",
  tableDate: "Date",
  tableLevel: "VR level",
  tableChange: "Change",
  tableEmpty: "No VR updates this season yet.",
  changeBump: "+250",
  changeFrom: "from {previous}",
  changeSet: "Set",
  anomalyTitle: "Confirm this VR level?",
  anomalyConfirm: "Yes, save it",
  anomalyDecline: "No, cancel",
  loadFailed: "Could not load your VR data.",
  updateFailed: "Could not update VR.",
} as const;
