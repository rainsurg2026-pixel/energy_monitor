import { useEffect, useState } from "react";
import type { RackApiSnapshot } from "./WebRackCapacityEditors";
import { api } from "./api";

export type RackCapacityResponse = {
  snapshot: RackApiSnapshot | null;
  carryForwardCandidate?: { sourceMonth: string; snapshot: RackApiSnapshot } | null;
};

export type RackCapacityState = {
  snapshot: RackApiSnapshot | null;
  persisted: boolean;
  sourceMonth: string | null;
  sourceRowVersion?: number;
};

export type RackCapacityLoadState = RackCapacityState & {
  key: string;
  status: "loading" | "ready" | "error";
  error: string | null;
};

const snapshotCache = new Map<string, RackCapacityState>();
const snapshotRequests = new Map<string, Promise<RackCapacityState>>();

export function rackCapacityKey(siteId: number, month: string): string {
  return `${siteId}:${month}`;
}

function stateFromResponse(response: RackCapacityResponse): RackCapacityState {
  const candidate = response.carryForwardCandidate;
  return {
    snapshot: response.snapshot ?? candidate?.snapshot ?? null,
    persisted: Boolean(response.snapshot),
    sourceMonth: response.snapshot ? null : candidate?.sourceMonth ?? null,
    sourceRowVersion: response.snapshot ? undefined : candidate?.snapshot.rowVersion
  };
}

export function loadRackCapacitySnapshot(siteId: number, month: string, force = false): Promise<RackCapacityState> {
  const key = rackCapacityKey(siteId, month);
  if (!force) {
    const cached = snapshotCache.get(key);
    if (cached) return Promise.resolve(cached);
  }
  const activeRequest = snapshotRequests.get(key);
  if (activeRequest && !force) return activeRequest;
  let request: Promise<RackCapacityState>;
  request = api<RackCapacityResponse>("/racks?siteId=" + siteId + "&month=" + encodeURIComponent(month))
    .then(response => {
      const state = stateFromResponse(response);
      if (snapshotRequests.get(key) === request) snapshotCache.set(key, state);
      return state;
    });
  snapshotRequests.set(key, request);
  void request.then(
    () => { if (snapshotRequests.get(key) === request) snapshotRequests.delete(key); },
    () => { if (snapshotRequests.get(key) === request) snapshotRequests.delete(key); }
  );
  return request;
}

export function cacheRackCapacitySnapshot(siteId: number, month: string, state: RackCapacityState): void {
  snapshotCache.set(rackCapacityKey(siteId, month), state);
}

export function clearRackCapacitySnapshotCache(): void {
  snapshotCache.clear();
  snapshotRequests.clear();
}

export function useRackCapacitySnapshot(siteId: number, month: string): RackCapacityLoadState {
  const [state, setState] = useState<RackCapacityLoadState>(() => ({ key: rackCapacityKey(siteId, month), snapshot: null, persisted: false, sourceMonth: null, status: "loading", error: null }));
  useEffect(() => {
    let cancelled = false;
    const key = rackCapacityKey(siteId, month);
    setState(previous => ({ ...previous, key, snapshot: null, persisted: false, sourceMonth: null, sourceRowVersion: undefined, status: "loading", error: null }));
    loadRackCapacitySnapshot(siteId, month)
      .then(next => { if (!cancelled) setState({ ...next, key, status: "ready", error: null }); })
      .catch(reason => { if (!cancelled) setState(previous => ({ ...previous, key, snapshot: null, persisted: false, sourceMonth: null, sourceRowVersion: undefined, status: "error", error: reason instanceof Error ? reason.message : "Rack Capacity could not be loaded." })); });
    return () => { cancelled = true; };
  }, [month, siteId]);
  return state;
}
