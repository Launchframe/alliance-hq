"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createVersionedLive, type SnapshotTransport, type VersionedSnapshot } from "@/lib/member-board/versioned-live";

export function useVersionedSnapshot<S extends VersionedSnapshot>({ scope, identity, initial, transport, pollMs = 30_000 }: {
  scope: string; identity: string; initial: S; transport: SnapshotTransport<S>; pollMs?: number;
}) {
  const [binding, setBinding] = useState(() => ({ scope, identity, transport, controller: createVersionedLive(initial, transport) }));
  let current = binding;
  if (binding.scope !== scope || binding.identity !== identity || binding.transport !== transport) {
    current = { scope, identity, transport, controller: createVersionedLive(initial, transport) };
    setBinding(current);
  }
  const { controller } = current;
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  useEffect(() => {
    controller.start((refresh) => {
      const timer = window.setInterval(refresh, pollMs);
      window.addEventListener("focus", refresh);
      return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
    });
    return controller.stop;
  }, [controller, pollMs]);
  return { ...state, refresh: controller.refresh };
}
