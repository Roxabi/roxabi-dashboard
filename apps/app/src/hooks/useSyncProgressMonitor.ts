/**
 * useSyncProgressMonitor — poll /api/sync/status every 2 s while a bootstrap
 * sync is in progress (ported from frontend/initial-sync.js). Stops polling once
 * the corpus is ready or the sync halts. Refetches the graph as repos land and
 * when the sync completes, so the board fills in live. Returns the latest status
 * for SyncProgressBanner (null until the first response).
 */

import { apiFetch } from "@/lib/api";
import { applyGraphDelta, fetchGraph, GRAPH_QUERY_KEY } from "@/lib/graph-fetch";
import type { SyncStatus } from "@roxabi-live/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const SYNC_POLL_MS = 2000;

async function refetchGraphOnce(client: ReturnType<typeof useQueryClient>): Promise<void> {
  await client.fetchQuery({
    queryKey: GRAPH_QUERY_KEY,
    queryFn: ({ client: qc }) => fetchGraph(qc),
  });
}

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

    const applyGraphUpdate = async (forceFull = false) => {
      if (!graphReady) return;

      if (forceFull || active) {
        try {
          await refetchGraphOnce(queryClient);
        } catch {
          /* quota — best effort */
        }
        return;
      }

      const outcome = await applyGraphDelta(queryClient);
      if (outcome === "fallback") {
        try {
          await refetchGraphOnce(queryClient);
        } catch {
          /* quota */
        }
      }
    };

    if (data.repos_synced > lastSynced.current) {
      lastSynced.current = data.repos_synced;
      if (active) {
        // During bootstrap, delta only — a full scan per repo exhausts graph_rows.
        if (graphReady) void applyGraphDelta(queryClient);
      } else {
        void applyGraphUpdate(false);
      }
    }
    if (wasActive.current && !active) {
      void applyGraphUpdate(true);
    }
    wasActive.current = active;
  }, [data, queryClient]);

  return data ?? null;
}