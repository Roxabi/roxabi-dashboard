/**
 * Client-side merge for incremental /api/graph?since=… responses.
 */

import type { GraphEdge, GraphNode, GraphResponse, RepoSummary } from "./types.ts";

function edgeId(edge: GraphEdge): string {
  return `${edge.src}\0${edge.dst}\0${edge.kind}`;
}

/** Merge a delta payload into a cached full graph (or return delta as full when no base). */
export function mergeGraphDelta(
  base: GraphResponse | undefined,
  delta: GraphResponse,
): GraphResponse {
  if (delta.mode !== "delta" || !base) {
    return {
      nodes: delta.nodes,
      edges: delta.edges,
      repos: delta.repos,
      mode: delta.mode ?? "full",
      version: delta.version,
      removed_keys: delta.removed_keys,
    };
  }

  const removed = new Set(delta.removed_keys ?? []);
  const touched = new Set<string>([
    ...delta.nodes.map((n) => n.key),
    ...removed,
  ]);

  const nodeByKey = new Map<string, GraphNode>(base.nodes.map((n) => [n.key, n]));
  for (const node of delta.nodes) {
    nodeByKey.set(node.key, node);
  }
  for (const key of removed) {
    nodeByKey.delete(key);
  }

  const edgeById = new Map<string, GraphEdge>();
  const hasEdgePatch = delta.edges.length > 0;
  for (const edge of base.edges) {
    if (removed.has(edge.src) || removed.has(edge.dst)) continue;
    if (hasEdgePatch && (touched.has(edge.src) || touched.has(edge.dst))) continue;
    edgeById.set(edgeId(edge), edge);
  }
  for (const edge of delta.edges) {
    edgeById.set(edgeId(edge), edge);
  }

  const repoByName = new Map<string, RepoSummary>(base.repos.map((r) => [r.repo, r]));
  for (const repo of delta.repos) {
    repoByName.set(repo.repo, repo);
  }

  return {
    nodes: [...nodeByKey.values()],
    edges: [...edgeById.values()],
    repos: [...repoByName.values()],
    mode: "full",
    version: delta.version ?? base.version,
  };
}