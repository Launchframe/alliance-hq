"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { EngView } from "@/components/professions/EngView";
import { OfficerPortal } from "@/components/professions/OfficerPortal";
import { ProfessionHero } from "@/components/professions/ProfessionHero";
import { WLView } from "@/components/professions/WLView";
import { Button } from "@/components/ui/button";
import type {
  MyEngTeamContext,
  MyWlTeamContext,
  OfficerActivityEvent,
  OfficerUnassignedEngRow,
  OfficerWlRow,
  Profession,
} from "@/lib/professions/types";

type Props = {
  allianceId: string | null;
  commanderId: string | null;
  profession: string | null;
  isOfficer: boolean;
};

type TeamData =
  | ({ profession: "Engineer" } & MyEngTeamContext)
  | ({ profession: "War Leader" } & MyWlTeamContext)
  | { profession: null | string; message?: string };

type OfficerData = {
  minEngsPerTeam: number;
  totalWls: number;
  coveredWls: number;
  wlRows: OfficerWlRow[];
  unassignedEngs: OfficerUnassignedEngRow[];
  recentEvents: OfficerActivityEvent[];
};

type PageTab = "mine" | "officer";

export function ProfessionsPage({
  allianceId,
  commanderId,
  profession,
  isOfficer,
}: Props) {
  const t = useTranslations("professions");
  const searchParams = useSearchParams();
  const initialTab =
    searchParams.get("tab") === "officer" && isOfficer ? "officer" : "mine";

  const [tab, setTab] = useState<PageTab>(initialTab);
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [officerData, setOfficerData] = useState<OfficerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [officerLoading, setOfficerLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function loadTeam(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/professions/my-team");
      if (res.ok) {
        const data = (await res.json()) as TeamData;
        setTeamData(data);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadOfficer() {
    setOfficerLoading(true);
    try {
      const res = await fetch("/api/professions/officer");
      if (res.ok) {
        const data = (await res.json()) as OfficerData;
        setOfficerData(data);
      }
    } finally {
      setOfficerLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/professions/my-team");
        if (!cancelled && res.ok) {
          const data = (await res.json()) as TeamData;
          setTeamData(data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSetProfession(p: Profession) {
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await fetch("/api/professions/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toProfession: p }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSwitchError(json.error ?? t("switchFailed"));
      } else {
        await loadTeam();
      }
    } finally {
      setSwitching(false);
    }
  }

  function handleSwitched() {
    void loadTeam();
    if (tab === "officer" && isOfficer) {
      void loadOfficer();
    }
  }

  if (!allianceId || !commanderId) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-xl font-semibold text-hq-fg">{t("pageTitle")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("linkRequired")}</p>
      </div>
    );
  }

  if (loading && tab === "mine") {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-xl font-semibold text-hq-fg">{t("pageTitle")}</h1>
        <div className="animate-pulse text-sm text-hq-fg-muted">
          {t("loading")}
        </div>
      </div>
    );
  }

  const resolvedProfession = teamData
    ? (teamData as { profession: string | null }).profession
    : profession;

  let professionSince: string | null = null;
  if (teamData?.profession === "Engineer") {
    professionSince = (teamData as Extract<TeamData, { profession: "Engineer" }>).professionSince;
  } else if (teamData?.profession === "War Leader") {
    professionSince = (teamData as Extract<TeamData, { profession: "War Leader" }>).professionSince;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-hq-fg">{t("pageTitle")}</h1>
        </div>
        {isOfficer ? (
          <div className="flex rounded-lg border border-hq-border p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setTab("mine")}
              className={`rounded-md px-3 py-1.5 ${
                tab === "mine"
                  ? "bg-hq-accent text-white"
                  : "text-hq-fg-muted hover:text-hq-fg"
              }`}
            >
              {t("myProfessionTab")}
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("officer");
                if (!officerData) void loadOfficer();
              }}
              className={`rounded-md px-3 py-1.5 ${
                tab === "officer"
                  ? "bg-hq-accent text-white"
                  : "text-hq-fg-muted hover:text-hq-fg"
              }`}
            >
              {t("officerTab")}
            </button>
          </div>
        ) : null}
      </div>

      {tab === "officer" && isOfficer ? (
        officerLoading || !officerData ? (
          <div className="animate-pulse text-sm text-hq-fg-muted">{t("loading")}</div>
        ) : (
          <OfficerPortal
            data={officerData}
            allianceId={allianceId}
            onRefresh={() => void loadOfficer()}
          />
        )
      ) : !resolvedProfession ? (
        <div className="max-w-lg space-y-6">
          <p className="text-sm text-hq-fg-muted">{t("chooseProfessionBody")}</p>
          {switchError ? (
            <p className="text-sm text-hq-danger">{switchError}</p>
          ) : null}
          <div className="flex gap-3">
            <Button
              onClick={() => void handleSetProfession("Engineer")}
              disabled={switching}
              variant="default"
            >
              {t("eng")}
            </Button>
            <Button
              onClick={() => void handleSetProfession("War Leader")}
              disabled={switching}
              variant="outline"
            >
              {t("wl")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ProfessionHero
            profession={resolvedProfession as Profession}
            professionSince={professionSince}
            onSwitched={handleSwitched}
          />
          {resolvedProfession === "Engineer" ? (
            <EngView
              teamContext={
                teamData as Extract<TeamData, { profession: "Engineer" }> | null
              }
              onRefresh={() => void loadTeam(false)}
            />
          ) : resolvedProfession === "War Leader" ? (
            <WLView
              teamContext={
                teamData as Extract<TeamData, { profession: "War Leader" }> | null
              }
              onRefresh={() => void loadTeam(false)}
            />
          ) : (
            <p className="text-sm text-hq-fg-muted">
              {t("unknownProfession", { profession: resolvedProfession })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
