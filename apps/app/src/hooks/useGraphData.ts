/**
 * useGraphData — fetch /api/graph and annotate the nodes.
 *
 * The raw {nodes, edges, repos} payload is cached by TanStack Query; the
 * annotated node array (computedStatus / parentKey / blockers) is derived in a
 * useMemo so it recomputes only when the payload changes. Server-side filters
 * (status[], closed_under_open_epic) join the queryKey in slice 3.
 */

import { GRAPH_QUERY_KEY, fetchGraph } from "@/lib/graph-fetch";
import {
  type AnnotatedNode,
  type GraphEdge,
  type RepoSummary,
  annotateNodes,
} from "@roxabi-live/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

export { GRAPH_QUERY_KEY };

export function useGraphData() {
  const query = useQuery({
    queryKey: GRAPH_QUERY_KEY,
    queryFn: ({ client }) => fetchGraph(client),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const nodes = useMemo<AnnotatedNode[]>(
    () => (query.data ? annotateNodes(query.data.nodes, query.data.edges) : []),
    [query.data],
  );

  return {
    ...query,
    nodes,
    edges: (query.data?.edges ?? []) as GraphEdge[],
    repos: (query.data?.repos ?? []) as RepoSummary[],
  };
}