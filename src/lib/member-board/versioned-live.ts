export type VersionedSnapshot = { version: number };
export class SnapshotAccessRevoked extends Error {}
export type SnapshotObserver = {
  ready: (version?: number) => void;
  invalidate: (version: number) => void;
  disconnect: () => void;
  revoke: () => void;
};
export type SnapshotTransport<S extends VersionedSnapshot> = {
  load: (signal: AbortSignal) => Promise<S>;
  subscribe: (observer: SnapshotObserver) => () => void;
  dispose: () => void;
};
export type SnapshotState<S> = { snapshot: S | null; connected: boolean; revoked: boolean; error: unknown };
export type SnapshotLifecycle = (refresh: () => void) => () => void;

export function createVersionedLive<S extends VersionedSnapshot>(initial: S, transport: SnapshotTransport<S>) {
  let state: SnapshotState<S> = { snapshot: initial, connected: false, revoked: false, error: null };
  let floor = initial.version;
  let generation = 0;
  let request: AbortController | undefined;
  let active = false;
  let unsubscribe: (() => void) | undefined;
  let cleanup: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: SnapshotState<S>) => { state = next; listeners.forEach((listener) => listener()); };
  const stop = () => {
    if (!active) return;
    active = false;
    generation++;
    request?.abort();
    unsubscribe?.();
    cleanup?.();
    unsubscribe = undefined;
    cleanup = undefined;
    transport.dispose();
    if (state.connected) publish({ ...state, connected: false });
  };
  const revoke = (error: unknown = new SnapshotAccessRevoked()) => {
    if (!active) return;
    stop();
    publish({ snapshot: null, connected: false, revoked: true, error });
  };
  const raiseFloor = (version: number) => { if (Number.isSafeInteger(version) && version >= 0) floor = Math.max(floor, version); };
  const refresh = async (minimumVersion = 0) => {
    if (!active || state.revoked) return;
    raiseFloor(minimumVersion);
    const current = ++generation;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    try {
      const next = await transport.load(controller.signal);
      if (!active || controller.signal.aborted || current !== generation) return;
      if (Number.isSafeInteger(next.version) && next.version >= floor) {
        floor = next.version;
        publish({ ...state, snapshot: next, error: null });
      }
    } catch (error) {
      if (!active || controller.signal.aborted || current !== generation) return;
      if (error instanceof SnapshotAccessRevoked) revoke(error);
      else publish({ ...state, connected: false, error });
    }
  };
  const observer: SnapshotObserver = {
    ready: (version = 0) => { if (active) { publish({ ...state, connected: true, error: null }); void refresh(version); } },
    invalidate: (version) => {
      if (!active) return;
      publish({ ...state, connected: true, error: null });
      if (version > (state.snapshot?.version ?? -1)) void refresh(version);
    },
    disconnect: () => { if (active) { publish({ ...state, connected: false }); void refresh(); } },
    revoke,
  };
  return {
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: (lifecycle?: SnapshotLifecycle) => {
      if (active || state.revoked) return;
      active = true;
      try { unsubscribe = transport.subscribe(observer); }
      catch (error) {
        if (error instanceof SnapshotAccessRevoked) revoke(error);
        else publish({ ...state, connected: false, error });
      }
      if (!active) { unsubscribe?.(); unsubscribe = undefined; return; }
      cleanup = lifecycle?.(() => void refresh());
      void refresh();
    },
    refresh,
    stop,
  };
}
