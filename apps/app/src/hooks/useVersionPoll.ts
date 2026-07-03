/**
 * useVersionPoll — poll /api/version every 15 s and apply a graph delta when the
 * corpus version token changes (hourly cron or a mutating webhook bumps it).
 * The first observed value is a baseline, not a change, so it never refetches on
 * mount.
 */

import { apiFetchConditional } from "@/lib/api";
import { getVersionEtag, setVersionEtag } from "@/lib/etag-cache";
import { applyGraphDelta, fetchGraph, GRAPH_QUERY_KEY } from "@/lib/graph-fetch";
import { type VersionResponse, runtimeConfig } from "@roxabi-live/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const VERSION_POLL_MS = runtimeConfig.client.pollIntervalMs.version;

function graphIsReady(client: ReturnType<typeof useQueryClient>): boolean {
  return client.getQueryState(GRAPH_QUERY_KEY)?.status === "success";
}

/** Deduped graph refetch — never use invalidateQueries (storm of parallel full scans). */
async function refetchGraphOnce(client: ReturnType<typeof useQueryClient>): Promise<void> {
  await client.fetchQuery({
    queryKey: GRAPH_QUERY_KEY,
    queryFn: ({ client: qc }) => fetchGraph(qc),
  });
}

export function useVersionPoll(): void {
  const queryClient = useQueryClient();
  const lastSeen = useRef<string | null>(null);

  const { data } = useQuery({
    queryKey: ["version"],
    queryFn: async ({ client }) => {
      const result = await apiFetchConditional<VersionResponse>("/api/version", getVersionEtag());
      if (result.notModified) {
        const cached = client.getQueryData<VersionResponse>(["version"]);
        if (cached) return cached;
      }
      setVersionEtag(result.etag);
      return result.data as VersionResponse;
    },
    refetchInterval: VERSION_POLL_MS,
  });

  useEffect(() => {
    const version = data?.version;
    if (version == null) return;
    if (lastSeen.current === null) {
      lastSeen.current = version;
      return;
    }
    if (lastSeen.current === version) return;
    if (!graphIsReady(queryClient)) return;

    void (async () => {
      const outcome = await applyGraphDelta(queryClient);
      if (outcome === "applied" || outcome === "noop") {
        lastSeen.current = version;
        return;
      }
      try {
        await refetchGraphOnce(queryClient);
        lastSeen.current = version;
      } catch {
        /* quota or network — keep lastSeen stale so we retry on next bump */
      }
    })();
  }, [data?.version, queryClient]);
}