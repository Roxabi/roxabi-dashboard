/**
 * Unified /api/graph fetch — full load, conditional GET, and ?since= delta merge.
 */

import { ApiError, apiFetchConditional } from "@/lib/api";
import { getGraphEtag, getGraphVersion, setGraphEtag, setGraphVersion } from "@/lib/etag-cache";
import { type GraphResponse, mergeGraphDelta } from "@roxabi-live/shared";
import type { QueryClient } from "@tanstack/react-query";

export const GRAPH_QUERY_KEY = ["graph"] as const;

export interface FetchGraphOptions {
  since?: string | null;
}

function graphPath(opts?: FetchGraphOptions): string {
  if (!opts?.since) return "/api/graph";
  const params = new URLSearchParams({ since: opts.since });
  return `/api/graph?${params.toString()}`;
}

/** TanStack queryFn — shared by useGraphData and useDecryptedGraph. */
export async function fetchGraph(
  client: QueryClient,
  opts?: FetchGraphOptions,
): Promise<GraphResponse> {
  try {
    const result = await apiFetchConditional<GraphResponse>(graphPath(opts), getGraphEtag());
    if (result.notModified) {
      const cached = client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY);
      if (cached) return cached;
    }

    const payload = result.data;
    if (!payload) {
      const cached = client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY);
      if (cached) return cached;
      throw new ApiError(500, "empty graph response");
    }

    let merged = payload;
    if (payload.mode === "delta" && opts?.since) {
      const cached = client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY);
      merged = mergeGraphDelta(cached, payload);
    }

    setGraphEtag(result.etag);
    if (merged.version) setGraphVersion(merged.version);

    return merged;
  } catch (err) {
    if (err instanceof ApiError && err.status === 429) {
      const cached = client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY);
      if (cached) return cached;
    }
    throw err;
  }
}

/** Refetch only the delta since the last known corpus version. */
export async function fetchGraphDelta(client: QueryClient): Promise<GraphResponse | null> {
  const since = getGraphVersion();
  if (!since) return null;
  return fetchGraph(client, { since });
}