/**
 * useVersionPoll — poll /api/version every 15 s and apply a graph delta when the
 * corpus version token changes (hourly cron or a mutating webhook bumps it).
 * The first observed value is a baseline, not a change, so it never refetches on
 * mount.
 */

import { apiFetchConditional } from "@/lib/api";
import { getVersionEtag, setVersionEtag } from "@/lib/etag-cache";
import { applyGraphDelta, GRAPH_QUERY_KEY } from "@/lib/graph-fetch";
import type { VersionResponse } from "@roxabi-live/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

const VERSION_POLL_MS = 15_000;

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
    if (lastSeen.current !== version) {
      void (async () => {
        const outcome = await applyGraphDelta(queryClient);
        if (outcome === "applied" || outcome === "noop") {
          lastSeen.current = version;
        } else {
          void queryClient.invalidateQueries({ queryKey: GRAPH_QUERY_KEY });
        }
      })();
    }
  }, [data?.version, queryClient]);
}