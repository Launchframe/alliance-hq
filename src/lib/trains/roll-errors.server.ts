import "server-only";

import type {
  TrainRollErrorDetails,
  WheelCandidateKind,
} from "@/lib/trains/roll-errors.shared";
import type { PoolType } from "@/lib/trains/types";

export class TrainRollError extends Error {
  readonly details: TrainRollErrorDetails;

  constructor(message: string, details: TrainRollErrorDetails) {
    super(message);
    this.name = "TrainRollError";
    this.details = details;
  }
}

export function throwPoolEmpty(poolType: PoolType): never {
  throw new TrainRollError(`No eligible members for ${poolType} pool.`, {
    code: "POOL_EMPTY",
    poolType,
  });
}

export function throwPoolExhausted(poolType: PoolType): never {
  throw new TrainRollError(
    "Pool exhausted. Re-seed the pool to start a new generation.",
    { code: "POOL_EXHAUSTED", poolType },
  );
}

export function throwPoolUnavailable(poolType?: PoolType): never {
  throw new TrainRollError("No pool entry available.", {
    code: "POOL_UNAVAILABLE",
    poolType,
  });
}

export function throwPoolBusy(poolType?: PoolType): never {
  throw new TrainRollError(
    "Another officer is spinning this pool right now. Try again in a moment.",
    { code: "POOL_BUSY", poolType },
  );
}

export function throwNoWheelCandidates(
  candidateKind: WheelCandidateKind,
  message: string,
  extras?: { scoreDate?: string; leadDays?: number },
): never {
  throw new TrainRollError(message, {
    code: "NO_WHEEL_CANDIDATES",
    candidateKind,
    ...(extras?.scoreDate !== undefined
      ? { scoreDate: extras.scoreDate }
      : {}),
    ...(extras?.leadDays !== undefined ? { leadDays: extras.leadDays } : {}),
  });
}

export function throwAshedRequired(message: string): never {
  throw new TrainRollError(message, { code: "ASHED_REQUIRED" });
}

export function trainRollErrorResponse(error: unknown) {
  if (error instanceof TrainRollError) {
    const status = error.details.code === "POOL_BUSY" ? (503 as const) : (400 as const);
    return {
      status,
      body: { error: error.message, rollError: error.details },
    };
  }

  return {
    status: 400 as const,
    body: {
      error: error instanceof Error ? error.message : "Request failed.",
    },
  };
}
