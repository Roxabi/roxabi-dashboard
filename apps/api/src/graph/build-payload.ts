/**
 * Shared graph corpus assembly for full and delta /api/graph responses.
 */

import { filterNodesByStatus, type GraphStatus } from "../graph/status";
import {
  issueRowToNode,
  loadEdgesForKeys,
  loadFullGraphRows,
  loadIssuesForKeys,
  loadLabelsForKeys,
  loadOpenPrsByIssue,
  loadRepos,
} from "./graph-payload-loaders";

export type {
  DevState,
  GraphBuildResult,
  GraphEdge,
  GraphNode,
  RepoSummary,
} from "./graph-payload-types";

import type { GraphBuildResult, GraphEdge, GraphNode } from "./graph-payload-types";

/** Expand dirty keys with direct edge neighbors still in visible repos. */
export async function expandGraphKeys(
  db: D1Database,
  seedKeys: string[],
  visible: string[],
): Promise<{ keys: string[]; rowsRead: number }> {
  if (seedKeys.length === 0) return { keys: [], rowsRead: 0 };
  const ph = seedKeys.map(() => "?").join(",");
  const repoPh = visible.map(() => "?").join(",");
  const edgeRows = await db
    .prepare(
      `SELECT DISTINCT e.src_key, e.dst_key
       FROM edges e
       INNER JOIN issues si ON si.key = e.src_key
       INNER JOIN issues di ON di.key = e.dst_key
       WHERE (e.src_key IN (${ph}) OR e.dst_key IN (${ph}))
         AND si.repo IN (${repoPh}) AND di.repo IN (${repoPh})`,
    )
    .bind(...seedKeys, ...seedKeys, ...visible, ...visible)
    .all<{ src_key: string; dst_key: string }>();
  const rowsRead = edgeRows.meta?.rows_read ?? 0;
  const expanded = new Set(seedKeys);
  for (const row of edgeRows.results) {
    expanded.add(row.src_key);
    expanded.add(row.dst_key);
  }
  return { keys: [...expanded], rowsRead };
}

export interface BuildGraphOptions {
  db: D1Database;
  visible: string[];
  sealedKeys: Set<string>;
  tenantId: number | null;
  keys?: string[];
  statusFilter: Set<GraphStatus> | null;
  closedUnderOpenEpic: boolean;
}

export async function buildGraphPayload(opts: BuildGraphOptions): Promise<GraphBuildResult> {
  const { db, visible, sealedKeys, tenantId, keys, statusFilter, closedUnderOpenEpic } = opts;
  let rowsRead = 0;

  const { map: openPrsByIssue, rowsRead: prRows } = await loadOpenPrsByIssue(db, visible, keys);
  rowsRead += prRows;

  let issueRows: Awaited<ReturnType<typeof loadIssuesForKeys>>["rows"];
  let labelsByIssue: Map<string, string[]>;
  let edges: GraphEdge[];

  if (keys) {
    const labelResult = await loadLabelsForKeys(db, keys);
    labelsByIssue = labelResult.map;
    rowsRead += labelResult.rowsRead;

    const issueResult = await loadIssuesForKeys(db, keys, visible);
    issueRows = issueResult.rows;
    rowsRead += issueResult.rowsRead;

    const edgeResult = await loadEdgesForKeys(db, keys);
    edges = edgeResult.edges;
    rowsRead += edgeResult.rowsRead;
  } else {
    const full = await loadFullGraphRows(db, visible);
    issueRows = full.issueRows;
    labelsByIssue = full.labelsByIssue;
    edges = full.edges;
    rowsRead += full.rowsRead;
  }

  let nodes: GraphNode[] = issueRows.map((row) =>
    issueRowToNode(row, labelsByIssue, openPrsByIssue, sealedKeys),
  );

  if (statusFilter !== null) {
    nodes = filterNodesByStatus(nodes, edges, statusFilter, { closedUnderOpenEpic });
    const nodeKeys = new Set(nodes.map((n) => n.key));
    edges = edges.filter((e) => nodeKeys.has(e.src) && nodeKeys.has(e.dst));
  }

  const repoFilter = keys ? [...new Set(nodes.map((n) => n.repo))] : undefined;
  const repoResult = await loadRepos(db, visible, tenantId, repoFilter);
  rowsRead += repoResult.rowsRead;

  return { nodes, edges, repos: repoResult.repos, rowsRead };
}