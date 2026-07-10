"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { InviteWizardProgress } from "@/components/settings/InviteWizardProgress";
import { InviteWizardResultStep } from "@/components/settings/InviteWizardResultStep";
import { InviteWizardTargetStep } from "@/components/settings/InviteWizardTargetStep";
import { InviteWizardTypeStep } from "@/components/settings/InviteWizardTypeStep";
import {
  generateInviteWizardResult,
  validateInviteWizardStep2,
} from "@/lib/settings/invite-wizard-generate.client";
import {
  defaultInviteWizardTargets,
  type InviteWizardResult,
  type InviteWizardStep,
  type InviteWizardTargets,
  type InviteWizardType,
} from "@/lib/settings/invite-wizard.shared";
import type { SystemRoleName } from "@/lib/rbac/constants";

type Props = {
  assignableRoles: SystemRoleName[];
  allianceName: string;
  deepLinkClaimCommanderId?: string | null;
  onGenerated?: () => void;
};

export function InviteWizard({
  assignableRoles,
  allianceName,
  deepLinkClaimCommanderId,
  onGenerated,
}: Props) {
  const t = useTranslations("team.invites");
  const tWizard = useTranslations("team.invites.wizard");

  const [step, setStep] = useState<InviteWizardStep>(1);
  const [inviteType, setInviteType] = useState<InviteWizardType | null>(null);
  const [targets, setTargets] = useState<InviteWizardTargets>(() =>
    defaultInviteWizardTargets(assignableRoles),
  );
  const [result, setResult] = useState<InviteWizardResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [commanders, setCommanders] = useState<
    Array<{ ashedMemberId: string; name: string }>
  >([]);
  const [nearFullRoster, setNearFullRoster] = useState(false);
  const [activeRosterCount, setActiveRosterCount] = useState(0);
  const [rosterMaxMembers, setRosterMaxMembers] = useState(100);
  const defaultsAppliedRef = useRef(false);

  const applyEntryDefaults = useCallback(
    (
      rows: Array<{ ashedMemberId: string; name: string }>,
      nearFull: boolean,
    ) => {
      if (defaultsAppliedRef.current) {
        return;
      }
      defaultsAppliedRef.current = true;

      const commanderId = deepLinkClaimCommanderId?.trim() ?? "";
      if (
        commanderId &&
        rows.some((commander) => commander.ashedMemberId === commanderId)
      ) {
        setInviteType("commander_claim");
        setStep(2);
        setTargets((prev) => ({
          ...prev,
          claimMode: "single",
          claimCommanderId: commanderId,
        }));
        return;
      }

      if (!nearFull) {
        return;
      }

      setInviteType((prev) => prev ?? "commander_claim");
      const preferredNonMemberRole = assignableRoles.find(
        (role) => role !== "member",
      );
      setTargets((prev) => ({
        ...prev,
        claimMode: rows.length > 1 ? "bulk" : prev.claimMode,
        inviteRole: preferredNonMemberRole ?? prev.inviteRole,
        joinCodeRole: preferredNonMemberRole ?? prev.joinCodeRole,
      }));
    },
    [assignableRoles, deepLinkClaimCommanderId],
  );

  const loadClaimableCommanders = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/team/claimable-commanders");
      if (!res.ok) return [];

      const data = (await res.json()) as {
        commanders?: Array<{ ashedMemberId: string; name: string }>;
        roster?: {
          activeCount?: number;
          maxMembers?: number;
          nearFull?: boolean;
        };
      };

      const rows = data.commanders ?? [];
      const nearFull = Boolean(data.roster?.nearFull);
      setCommanders(rows);
      setNearFullRoster(nearFull);
      setActiveRosterCount(data.roster?.activeCount ?? 0);
      setRosterMaxMembers(data.roster?.maxMembers ?? 100);
      applyEntryDefaults(rows, nearFull);

      return rows;
    } catch {
      return [];
    }
  }, [applyEntryDefaults]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadClaimableCommanders();
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [loadClaimableCommanders]);

  const step2ErrorKey = useMemo(() => {
    if (!inviteType) return null;
    return validateInviteWizardStep2({ type: inviteType, targets });
  }, [inviteType, targets]);

  function patchTargets(patch: Partial<InviteWizardTargets>) {
    setTargets((prev) => ({ ...prev, ...patch }));
    setResult(null);
    setError(null);
  }

  function selectType(type: InviteWizardType) {
    setInviteType(type);
    setResult(null);
    setError(null);
  }

  function resetWizard() {
    setStep(1);
    setInviteType(nearFullRoster ? "commander_claim" : null);
    setTargets(defaultInviteWizardTargets(assignableRoles));
    setResult(null);
    setError(null);
    void loadClaimableCommanders();
  }

  async function handleGenerate() {
    if (!inviteType) return;

    setBusy(true);
    setError(null);

    try {
      const generated = await generateInviteWizardResult({
        type: inviteType,
        targets,
        allianceName,
        commanders,
      });
      setResult(generated);
      onGenerated?.();
      void loadClaimableCommanders();
      if (inviteType === "commander_claim") {
        setTargets((prev) => ({
          ...prev,
          claimCommanderId: "",
          bulkSelectedIds: [],
          claimAdminLabel: "",
        }));
      }
    } catch (err) {
      if (err instanceof Error && err.message === "COMMANDER_ALREADY_CLAIMED") {
        setError(t("claimAlreadyClaimed"));
        void loadClaimableCommanders();
        setTargets((prev) => ({ ...prev, claimCommanderId: "" }));
      } else {
        setError(err instanceof Error ? err.message : tWizard("generateFailed"));
      }
    } finally {
      setBusy(false);
    }
  }

  function goToStep(next: InviteWizardStep) {
    setStep(next);
    if (next < 3) {
      setResult(null);
      setError(null);
    }
  }

  const canContinueStep1 = inviteType !== null;
  const canContinueStep2 =
    inviteType !== null &&
    step2ErrorKey === null &&
    (inviteType !== "commander_claim" || commanders.length > 0);

  return (
    <div className="space-y-4">
      <InviteWizardProgress step={step} inviteType={inviteType} />

      {nearFullRoster ? (
        <div
          className="rounded-lg border border-[#388bfd]/40 bg-[#388bfd]/10 p-4 text-sm text-[#c9d1d9]"
          role="status"
        >
          {t("nearFullRosterBanner", {
            count: activeRosterCount,
            max: rosterMaxMembers,
          })}
        </div>
      ) : null}

      {step === 1 ? (
        <InviteWizardTypeStep selected={inviteType} onSelect={selectType} />
      ) : null}

      {step === 2 && inviteType ? (
        <InviteWizardTargetStep
          inviteType={inviteType}
          targets={targets}
          onChange={patchTargets}
          assignableRoles={assignableRoles}
          commanders={commanders}
          nearFullRoster={nearFullRoster}
        />
      ) : null}

      {step === 3 && inviteType ? (
        <InviteWizardResultStep
          inviteType={inviteType}
          result={result}
          busy={busy}
          error={error}
          onGenerate={() => void handleGenerate()}
        />
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-[#30363d] pt-4">
        {step > 1 ? (
          <button
            type="button"
            onClick={() => goToStep((step - 1) as InviteWizardStep)}
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
          >
            {tWizard("back")}
          </button>
        ) : null}

        {step === 1 ? (
          <button
            type="button"
            disabled={!canContinueStep1}
            onClick={() => goToStep(2)}
            className="rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
          >
            {tWizard("continue")}
          </button>
        ) : null}

        {step === 2 ? (
          <button
            type="button"
            disabled={!canContinueStep2}
            onClick={() => {
              if (step2ErrorKey) {
                setError(t(step2ErrorKey as "inviteRoleRequired"));
                return;
              }
              goToStep(3);
            }}
            className="rounded-lg border border-[#388bfd] bg-[#388bfd]/10 px-4 py-2 text-sm text-[#58a6ff] disabled:opacity-50"
          >
            {tWizard("continue")}
          </button>
        ) : null}

        {step === 3 && result ? (
          <button
            type="button"
            onClick={resetWizard}
            className="rounded-lg border border-[#238636] bg-[#238636] px-4 py-2 text-sm text-white"
          >
            {tWizard("createAnother")}
          </button>
        ) : null}
      </div>

      {step === 2 && step2ErrorKey ? (
        <p className="text-sm text-[#f85149]" role="alert">
          {t(step2ErrorKey as "inviteRoleRequired")}
        </p>
      ) : null}
    </div>
  );
}
