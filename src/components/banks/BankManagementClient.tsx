"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { BankEditorModal } from "@/components/banks/BankEditorModal";
import { BankList } from "@/components/banks/BankList";
import { BankManagementSettingsMenu } from "@/components/banks/BankManagementSettingsMenu";
import { CityListImportModal } from "@/components/banks/CityListImportModal";
import { AllianceSafeTimeSetupBanner } from "@/components/alliance/AllianceSafeTimeSetupBanner";
import { DepositFalloffChart } from "@/components/banks/DepositFalloffChart";
import { DepositSlipEditorModal } from "@/components/banks/DepositSlipEditorModal";
import { DepositSlipList } from "@/components/banks/DepositSlipList";
import { InvestorRiskHeatmap } from "@/components/banks/InvestorRiskHeatmap";
import { RecommendedDropCard } from "@/components/banks/RecommendedDropCard";
import { ScheduleDropMarkerModal } from "@/components/banks/ScheduleDropMarkerModal";
import {
  defaultDatetimeLocalValue,
  fromDatetimeLocalValue,
} from "@/components/banks/datetime-local";
import { Dialog } from "@/components/ui/dialog";
import { Link } from "@/i18n/navigation";
import { formatCityListServerTime } from "@/lib/banks/city-list-server-time.shared";
import type { BankPayload, DepositSlipPayload } from "@/lib/banks/api.shared";
import { findScheduledBankBattlePlanEvent } from "@/lib/banks/bank-battle-plan-markers.shared";
import { resolveProtectionExpiresAt } from "@/lib/banks/protection-timer.shared";
import {
  createScheduledDropBattlePlanEvent,
  syncDepositWindowBattlePlanEvent,
} from "@/lib/banks/sync-bank-battle-plan-events.client";
import { findNextAvailableMarkerPreset } from "@/lib/battle-plan/marker-conflict.shared";
import type { MarkerIconPreset } from "@/lib/battle-plan/marker-icons.shared";
import { readStoredBattlePlanTimeDisplay } from "@/lib/battle-plan/time-display.shared";
import { estimateDropSafeAtIso, recommendNextDrop } from "@/lib/banks/optimization.shared";
import type {
  BankBattlePlanSnapshot,
  BankManagementPayload,
  BankWithSlips,
  SerializedBank,
  SerializedDepositSlip,
} from "@/lib/banks/types.shared";

type Props = {
  initial: BankManagementPayload;
};

type BankMutationResponse = { bank: SerializedBank; dashboard: BankManagementPayload };
type SlipMutationResponse = {
  depositSlip: SerializedDepositSlip;
  dashboard: BankManagementPayload;
};
type DashboardOnlyResponse = { dashboard: BankManagementPayload };

type PendingDelete =
  | { kind: "bank"; bank: SerializedBank }
  | { kind: "slip"; slip: SerializedDepositSlip; closeSlipModal: boolean };

export function BankManagementClient({ initial }: Props) {
  const t = useTranslations("bankManagement");

  const [banks, setBanks] = useState<BankWithSlips[]>(initial.banks);
  const [heatmaps, setHeatmaps] = useState(initial.heatmaps);
  const [canWrite, setCanWrite] = useState(initial.canWrite);
  const [allianceId, setAllianceId] = useState(initial.allianceId);
  const [allianceTag, setAllianceTag] = useState(initial.allianceTag);
  const [allianceGameServerNumber, setAllianceGameServerNumber] = useState(
    initial.allianceGameServerNumber,
  );
  const [bankCapturesRemainingToday, setBankCapturesRemainingToday] = useState(
    initial.bankCapturesRemainingToday,
  );
  const [bankCapturesLimitToday, setBankCapturesLimitToday] = useState(
    initial.bankCapturesLimitToday,
  );
  const [bankCityListServerTime, setBankCityListServerTime] = useState(
    initial.bankCityListServerTime,
  );
  const [allianceSafeTimeSlot, setAllianceSafeTimeSlot] = useState(
    initial.allianceSafeTimeSlot,
  );
  const [battlePlan, setBattlePlan] = useState<BankBattlePlanSnapshot | null>(
    initial.battlePlan,
  );
  const [timeDisplay] = useState(() => readStoredBattlePlanTimeDisplay());
  const [settingsOpenToken, setSettingsOpenToken] = useState(0);
  const [cityListModalOpen, setCityListModalOpen] = useState(false);

  const [selectedBankId, setSelectedBankId] = useState<string | null>(
    initial.recommendation?.bankId ?? initial.banks[0]?.id ?? null,
  );

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<SerializedBank | null>(null);
  const [bankModalToken, setBankModalToken] = useState(0);

  const [slipModalOpen, setSlipModalOpen] = useState(false);
  const [slipModalBankId, setSlipModalBankId] = useState<string | null>(null);
  const [editingSlip, setEditingSlip] = useState<SerializedDepositSlip | null>(null);
  const [slipModalToken, setSlipModalToken] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [scheduleDropModal, setScheduleDropModal] = useState<{
    bankId: string;
    scheduledAt: string;
    iconPreset: MarkerIconPreset | null;
  } | null>(null);

  const recommendation = useMemo(() => recommendNextDrop(banks), [banks]);

  const selectedBank = useMemo(
    () => banks.find((bank) => bank.id === selectedBankId) ?? null,
    [banks, selectedBankId],
  );

  const recommendedDropAtIso = useMemo(() => {
    if (!recommendation || !selectedBank || recommendation.bankId !== selectedBank.id) {
      return null;
    }
    return estimateDropSafeAtIso(recommendation.hoursUntilAllMature);
  }, [recommendation, selectedBank]);

  const applyDashboard = useCallback((dashboard: BankManagementPayload) => {
    setBanks(dashboard.banks);
    setHeatmaps(dashboard.heatmaps);
    setCanWrite(dashboard.canWrite);
    setAllianceId(dashboard.allianceId);
    setAllianceTag(dashboard.allianceTag);
    setAllianceGameServerNumber(dashboard.allianceGameServerNumber);
    setBankCapturesRemainingToday(dashboard.bankCapturesRemainingToday);
    setBankCapturesLimitToday(dashboard.bankCapturesLimitToday);
    setBankCityListServerTime(dashboard.bankCityListServerTime);
    setAllianceSafeTimeSlot(dashboard.allianceSafeTimeSlot);
    if (dashboard.battlePlan) {
      setBattlePlan(dashboard.battlePlan);
    }
    setError(null);
  }, []);

  const handleMutationError = useCallback(async (response: Response) => {
    const data = (await response.json().catch(() => null)) as
      | { error?: string; dashboard?: BankManagementPayload }
      | null;
    if (data?.dashboard) {
      applyDashboard(data.dashboard);
    }
    setError(data?.error ?? t("errors.saveFailed"));
  }, [applyDashboard, t]);

  const openCreateBankModal = () => {
    setEditingBank(null);
    setBankModalToken((token) => token + 1);
    setBankModalOpen(true);
  };

  const openEditBankModal = (bank: BankWithSlips) => {
    setEditingBank(bank);
    setBankModalToken((token) => token + 1);
    setBankModalOpen(true);
  };

  const saveBank = async (
    payload: BankPayload,
    options?: { depositWindowIconPreset: MarkerIconPreset | null },
  ) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        editingBank ? `/api/banks/${editingBank.id}` : "/api/banks",
        {
          method: editingBank ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        await handleMutationError(response);
        return;
      }
      const data = (await response.json()) as BankMutationResponse;
      applyDashboard(data.dashboard);
      const bank = data.bank;

      if (options && battlePlan) {
        const protectionExpiresAt = resolveProtectionExpiresAt({
          explicit: null,
          capturedAt: bank.capturedAt ? new Date(bank.capturedAt) : null,
          safeTimeSlot: data.dashboard.allianceSafeTimeSlot,
        });
        const existingEvent = findScheduledBankBattlePlanEvent(
          battlePlan.events,
          bank.id,
          "deposit_window",
        );
        const updatedBattlePlan = await syncDepositWindowBattlePlanEvent({
          bank,
          iconPreset: options.depositWindowIconPreset,
          protectionExpiresAt,
          existingEvent,
          battlePlan,
        });
        setBattlePlan(updatedBattlePlan);
      }

      setSelectedBankId(bank.id);
      setBankModalOpen(false);
      setEditingBank(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("errors.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteBank = async () => {
    if (!editingBank) return;
    setPendingDelete({ kind: "bank", bank: editingBank });
  };

  const deleteSlip = async () => {
    if (!editingSlip) return;
    setPendingDelete({
      kind: "slip",
      slip: editingSlip,
      closeSlipModal: true,
    });
  };

  const requestDeleteSlip = async (slip: SerializedDepositSlip) => {
    setPendingDelete({ kind: "slip", slip, closeSlipModal: false });
  };

  const confirmPendingDelete = async () => {
    if (!pendingDelete) return;
    setSaving(true);
    setError(null);
    try {
      if (pendingDelete.kind === "bank") {
        const response = await fetch(`/api/banks/${pendingDelete.bank.id}/drop`, {
          method: "POST",
        });
        if (!response.ok) {
          await handleMutationError(response);
          return;
        }
        const data = (await response.json()) as DashboardOnlyResponse;
        applyDashboard(data.dashboard);
        if (selectedBankId === pendingDelete.bank.id) {
          setSelectedBankId(data.dashboard.banks[0]?.id ?? null);
        }
        setBankModalOpen(false);
        setEditingBank(null);
      } else {
        const response = await fetch(
          `/api/banks/deposit-slips/${pendingDelete.slip.id}`,
          { method: "DELETE" },
        );
        if (!response.ok) {
          await handleMutationError(response);
          return;
        }
        const data = (await response.json()) as DashboardOnlyResponse;
        applyDashboard(data.dashboard);
        if (pendingDelete.closeSlipModal) {
          setSlipModalOpen(false);
          setEditingSlip(null);
          setSlipModalBankId(null);
        }
      }
      setPendingDelete(null);
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const openCreateSlipModal = (bankId: string) => {
    setSlipModalBankId(bankId);
    setEditingSlip(null);
    setSlipModalToken((token) => token + 1);
    setSlipModalOpen(true);
  };

  const openEditSlipModal = (slip: SerializedDepositSlip) => {
    setSlipModalBankId(slip.bankId);
    setEditingSlip(slip);
    setSlipModalToken((token) => token + 1);
    setSlipModalOpen(true);
  };

  const saveSlip = async (payload: DepositSlipPayload) => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        editingSlip
          ? `/api/banks/deposit-slips/${editingSlip.id}`
          : "/api/banks/deposit-slips",
        {
          method: editingSlip ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        await handleMutationError(response);
        return;
      }
      const data = (await response.json()) as SlipMutationResponse;
      applyDashboard(data.dashboard);
      setSlipModalOpen(false);
      setEditingSlip(null);
      setSlipModalBankId(null);
    } catch {
      setError(t("errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const openScheduleDropModal = (bankId: string) => {
    if (!battlePlan) {
      setError(t("errors.scheduleFailed"));
      return;
    }
    setScheduleDropModal({
      bankId,
      scheduledAt: defaultDatetimeLocalValue(30),
      iconPreset: findNextAvailableMarkerPreset(battlePlan.events),
    });
  };

  const confirmScheduleDrop = async () => {
    if (!scheduleDropModal || !battlePlan) {
      return;
    }
    const scheduledAtIso = fromDatetimeLocalValue(scheduleDropModal.scheduledAt);
    if (!scheduledAtIso || !scheduleDropModal.iconPreset) {
      setError(t("errors.scheduleFailed"));
      return;
    }
    setScheduling(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await createScheduledDropBattlePlanEvent({
        bankId: scheduleDropModal.bankId,
        scheduledAtIso,
        iconPreset: scheduleDropModal.iconPreset,
        battlePlan,
      });
      setBattlePlan(updated);
      setScheduleDropModal(null);
      setSuccessMessage(t("dropScheduled"));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("errors.scheduleFailed"),
      );
    } finally {
      setScheduling(false);
    }
  };

  const scheduleDropBankLabel = useMemo(() => {
    if (!scheduleDropModal) {
      return "";
    }
    const bank = banks.find((row) => row.id === scheduleDropModal.bankId);
    if (!bank) {
      return "";
    }
    return t("coords", {
      server: bank.gameServerNumber,
      x: bank.coordX,
      y: bank.coordY,
    });
  }, [banks, scheduleDropModal, t]);

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-hq-fg">{t("title")}</h1>
            <p className="mt-1 text-sm text-hq-fg-muted">{t("subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <BankManagementSettingsMenu
                allianceTag={allianceTag}
                allianceSafeTimeSlot={allianceSafeTimeSlot}
                canWrite={canWrite}
                onSaved={setAllianceSafeTimeSlot}
                onError={(message) => setError(message)}
                openRequestToken={settingsOpenToken}
              />
            ) : null}
            <Link
              href="/guides/bank-lifecycle"
              className="text-xs text-hq-accent hover:underline"
            >
              {t("lifecycleGuideLink")}
            </Link>
          </div>
        </div>
        {bankCityListServerTime || bankCapturesRemainingToday != null ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-hq-fg-muted">
            {bankCityListServerTime ? (
              <span className="rounded-full border border-hq-border px-2.5 py-1">
                {t("cityListServerTime", {
                  time: formatCityListServerTime(bankCityListServerTime),
                })}
              </span>
            ) : null}
            {bankCapturesRemainingToday != null && bankCapturesLimitToday != null ? (
              <span className="rounded-full border border-hq-border px-2.5 py-1">
                {t("capturesLeftToday", {
                  remaining: bankCapturesRemainingToday,
                  limit: bankCapturesLimitToday,
                })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-hq-danger/40 bg-hq-danger/10 px-4 py-3 text-sm text-hq-danger">
          {error}
        </div>
      ) : null}
      {successMessage ? (
        <div className="rounded-lg border border-hq-success/40 bg-hq-success/10 px-4 py-3 text-sm text-hq-success">
          {successMessage}
        </div>
      ) : null}

      {canWrite && allianceSafeTimeSlot == null ? (
        <AllianceSafeTimeSetupBanner
          onOpenSettings={() => setSettingsOpenToken((token) => token + 1)}
        />
      ) : null}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <BankList
            banks={banks}
            selectedBankId={selectedBankId}
            canWrite={canWrite}
            allianceSafeTimeSlot={allianceSafeTimeSlot}
            battlePlanEvents={battlePlan?.events ?? []}
            onSelect={setSelectedBankId}
            onEdit={openEditBankModal}
            onAdd={openCreateBankModal}
            onImportFromScreenshot={() => setCityListModalOpen(true)}
          />
          <DepositSlipList
            bank={selectedBank}
            canWrite={canWrite}
            onAdd={() => selectedBank && openCreateSlipModal(selectedBank.id)}
            onEdit={openEditSlipModal}
            onDelete={requestDeleteSlip}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <RecommendedDropCard
            recommendation={recommendation}
            canWrite={canWrite}
            scheduling={scheduling}
            onRequestScheduleDrop={openScheduleDropModal}
          />
          {selectedBank ? (
            <InvestorRiskHeatmap
              bank={selectedBank}
              cells={heatmaps[selectedBank.id] ?? []}
            />
          ) : null}
          <DepositFalloffChart
            allianceId={allianceId}
            allianceTag={allianceTag}
            bank={selectedBank}
            banks={banks}
            recommendedDropAtIso={recommendedDropAtIso}
            canWrite={canWrite}
          />
        </div>
      </div>

      <CityListImportModal
        open={cityListModalOpen}
        onOpenChange={setCityListModalOpen}
        allianceId={allianceId}
      />

      <BankEditorModal
        key={bankModalToken}
        open={bankModalOpen}
        initial={editingBank}
        defaultGameServerNumber={allianceGameServerNumber}
        allianceSafeTimeSlot={allianceSafeTimeSlot}
        battlePlanEvents={battlePlan?.events ?? []}
        timeDisplay={timeDisplay}
        saving={saving}
        error={bankModalOpen ? error : null}
        onClose={() => {
          setBankModalOpen(false);
          setEditingBank(null);
        }}
        onSubmit={saveBank}
        onDelete={editingBank ? deleteBank : undefined}
      />

      <DepositSlipEditorModal
        key={slipModalToken}
        open={slipModalOpen}
        bankId={slipModalBankId}
        initial={editingSlip}
        saving={saving}
        error={slipModalOpen ? error : null}
        onClose={() => {
          setSlipModalOpen(false);
          setEditingSlip(null);
          setSlipModalBankId(null);
        }}
        onSubmit={saveSlip}
        onDelete={editingSlip ? deleteSlip : undefined}
      />

      <ScheduleDropMarkerModal
        open={scheduleDropModal != null}
        bankLabel={scheduleDropBankLabel}
        scheduledAt={scheduleDropModal?.scheduledAt ?? ""}
        iconPreset={scheduleDropModal?.iconPreset ?? null}
        events={battlePlan?.events ?? []}
        timeDisplay={timeDisplay}
        saving={scheduling}
        onScheduledAtChange={(value) =>
          setScheduleDropModal((current) =>
            current ? { ...current, scheduledAt: value } : current,
          )
        }
        onIconPresetChange={(preset) =>
          setScheduleDropModal((current) =>
            current ? { ...current, iconPreset: preset } : current,
          )
        }
        onClose={() => setScheduleDropModal(null)}
        onConfirm={() => void confirmScheduleDrop()}
      />

      <Dialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={
          pendingDelete?.kind === "bank"
            ? t("deleteBank")
            : t("deleteDeposit")
        }
        className="w-full max-w-md rounded-xl border border-hq-border bg-hq-surface p-4 shadow-xl"
      >
        <p className="text-sm text-hq-fg">
          {pendingDelete?.kind === "bank"
            ? t("actions.confirmDeleteBank")
            : t("actions.confirmDeleteDeposit")}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-hq-border px-3 py-2 text-sm text-hq-fg"
            onClick={() => setPendingDelete(null)}
            disabled={saving}
          >
            {t("actions.cancel")}
          </button>
          <button
            type="button"
            className="rounded bg-hq-danger px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
            onClick={() => void confirmPendingDelete()}
            disabled={saving}
          >
            {saving ? t("actions.saving") : t("actions.delete")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
