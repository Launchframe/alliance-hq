"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { EngView } from "@/components/professions/EngView";
import { WLView } from "@/components/professions/WLView";
import { Button } from "@/components/ui/button";
import type { MyEngTeamContext, MyWlTeamContext } from "@/lib/professions/types";

type Props = {
  allianceId: string | null;
  commanderId: string | null;
  profession: string | null;
};

type TeamData =
  | ({ profession: "Engineer" } & MyEngTeamContext)
  | ({ profession: "War Leader" } & MyWlTeamContext)
  | { profession: null | string; message?: string };

export function ProfessionsPage({ allianceId, commanderId, profession }: Props) {
  const t = useTranslations("professions");
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function loadTeam(showLoading = true) {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/professions/my-team");
      if (res.ok) {
        const data = await res.json() as TeamData;
        setTeamData(data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/professions/my-team");
        if (!cancelled && res.ok) {
          const data = await res.json() as TeamData;
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

  async function handleSetProfession(p: "Engineer" | "War Leader") {
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await fetch("/api/professions/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toProfession: p }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        setSwitchError(json.error ?? "Switch failed.");
      } else {
        await loadTeam();
      }
    } finally {
      setSwitching(false);
    }
  }

  if (!allianceId || !commanderId) {
    return (
      <div className="p-6 text-hq-fg-muted text-sm">
        No alliance or commander linked. Complete member linking first.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 text-hq-fg-muted text-sm animate-pulse">
        Loading…
      </div>
    );
  }

  const resolvedProfession = teamData
    ? (teamData as { profession: string | null }).profession
    : profession;

  if (!resolvedProfession) {
    return (
      <div className="p-6 max-w-lg">
        <h1 className="text-xl font-semibold text-hq-fg mb-2">{t("title")}</h1>
        <p className="text-sm text-hq-fg-muted mb-6">{t("chooseProfessionBody")}</p>
        {switchError && (
          <p className="text-sm text-hq-danger mb-4">{switchError}</p>
        )}
        <div className="flex gap-3">
          <Button
            onClick={() => handleSetProfession("Engineer")}
            disabled={switching}
            variant="default"
          >
            {t("eng")}
          </Button>
          <Button
            onClick={() => handleSetProfession("War Leader")}
            disabled={switching}
            variant="outline"
          >
            {t("wl")}
          </Button>
        </div>
      </div>
    );
  }

  if (resolvedProfession === "Engineer") {
    const ctx = teamData as Extract<TeamData, { profession: "Engineer" }> | null;
    return (
      <EngView
        teamContext={ctx ?? null}
        onRefresh={loadTeam}
      />
    );
  }

  if (resolvedProfession === "War Leader") {
    const ctx = teamData as Extract<TeamData, { profession: "War Leader" }> | null;
    return (
      <WLView
        teamContext={ctx ?? null}
        onRefresh={loadTeam}
      />
    );
  }

  return (
    <div className="p-6 text-hq-fg-muted text-sm">
      Unrecognized profession: {resolvedProfession}. Contact an officer.
    </div>
  );
}
