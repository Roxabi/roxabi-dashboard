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

export type GraphDeltaOutcome = "applied" | "noop" | "fallback";

function graphPath(opts?: FetchGraphOptions): string {
  if (!opts?.since) return "/api/graph";
  const params = new URLSearchParams({ since: opts.since });
  return `/api/graph?${params.toString()}`;
}

function graphSince(client: QueryClient): string | null {
  return getGraphVersion() ?? client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY)?.version ?? null;
}

let deltaApplyChain: Promise<void> = Promise.resolve();

/** Serialize delta apply so concurrent poll/sync hooks cannot race on setQueryData. */
async function withDeltaLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = deltaApplyChain;
  let release!: () => void;
  deltaApplyChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
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

/** Apply a graph delta since the last known corpus version. */
export async function applyGraphDelta(client: QueryClient): Promise<GraphDeltaOutcome> {
  const since = graphSince(client);
  if (!since) return "fallback";
  if (!client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY)) return "fallback";

  return withDeltaLock(async () => {
    const cached = client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY);
    if (!cached) return "fallback";

    try {
      const result = await apiFetchConditional<GraphResponse>(graphPath({ since }), getGraphEtag());
      if (result.notModified) return "noop";

      const payload = result.data;
      if (!payload) return "fallback";

      if (
        payload.mode === "delta" &&
        payload.version &&
        cached.version &&
        payload.version <= cached.version
      ) {
        return "noop";
      }

      const merged =
        payload.mode === "delta" ? mergeGraphDelta(cached, payload) : payload;

      client.setQueryData(GRAPH_QUERY_KEY, merged);
      setGraphEtag(result.etag);
      if (merged.version) setGraphVersion(merged.version);
      return "applied";
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && cached) return "noop";
      return "fallback";
    }
  });
}

/** Refetch only the delta since the last known corpus version. */
export async function fetchGraphDelta(client: QueryClient): Promise<GraphResponse | null> {
  const outcome = await applyGraphDelta(client);
  if (outcome === "fallback") return null;
  return client.getQueryData<GraphResponse>(GRAPH_QUERY_KEY) ?? null;
}