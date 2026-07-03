/**
 * useSyncProgressMonitor — poll /api/sync/status every 2 s while a bootstrap
 * sync is in progress (ported from frontend/initial-sync.js). Stops polling once
 * the corpus is ready or the sync halts. Applies graph deltas as repos land and
 * when the sync completes. Returns the latest status for SyncProgressBanner.
 */

import { apiFetch } from "@/lib/api";
import { applyGraphDelta, GRAPH_QUERY_KEY } from "@/lib/graph-fetch";
import { type SyncStatus, runtimeConfig } from "@roxabi-live/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const SYNC_POLL_MS = runtimeConfig.client.pollIntervalMs.syncStatus;

export function useSyncProgressMonitor(): SyncStatus | null {
  const queryClient = useQueryClient();
  const lastSynced = useRef(-1);
  const wasActive = useRef(false);

  const { data } = useQuery({
    queryKey: ["sync-status"],
    queryFn: () => apiFetch<SyncStatus>("/api/sync/status"),
    retry: false,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const s = query.state.data;
      if (!s) return SYNC_POLL_MS;
      if (s.sync_halted) return false;
      return s.sync_in_progress || s.sync_running ? SYNC_POLL_MS : false;
    },
  });

  useEffect(() => {
    if (!data) return;
    const active = data.sync_in_progress || data.sync_running;
    const graphReady = queryClient.getQueryState(GRAPH_QUERY_KEY)?.status === "success";
    if (!graphReady) return;

    if (data.repos_synced > lastSynced.current) {
      lastSynced.current = data.repos_synced;
      void applyGraphDelta(queryClient);
    }
    if (wasActive.current && !active) {
      void applyGraphDelta(queryClient);
    }
    wasActive.current = active;
  }, [data, queryClient]);

  return data ?? null;
}