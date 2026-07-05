/**
 * D1 loaders + row→node mapping for graph payload assembly.
 */

import { redactIssueTitle } from "../auth/zk";
import { parseMilestone } from "../sync/parse";
import type { IssueRow } from "./graph-payload-bulk";
import type { DevState, GraphEdge, GraphNode } from "./graph-payload-types";

const LANE_LABEL_PREFIX = "graph:lane/";

interface PrInfo {
  has_reviewed_label: number;
}

interface LabelRow {
  issue_key: string;
  name: string;
}

interface PrStateRow {
  closing_issue_keys: string | null;
  has_reviewed_label: number;
}

interface EdgeRow {
  src_key: string;
  dst_key: string;
  kind: string;
}

function parseAssignees(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function laneFromLabels(labels: string[]): string | null {
  for (const lbl of labels) {
    if (lbl.startsWith(LANE_LABEL_PREFIX)) {
      return lbl.slice(LANE_LABEL_PREFIX.length);
    }
  }
  return null;
}

function computeDevState(issueState: string, hasActiveBranch: number, openPrs: PrInfo[]): DevState {
  if (issueState === "closed") return "idle";
  if (openPrs.some((pr) => pr.has_reviewed_label)) return "pr_reviewed";
  if (openPrs.length > 0) return "pr_open";
  if (hasActiveBranch) return "dev";
  return "idle";
}

export function issueRowToNode(
  row: IssueRow,
  labelsByIssue: Map<string, string[]>,
  openPrsByIssue: Map<string, PrInfo[]>,
  sealedKeys: Set<string>,
): GraphNode {
  const issueLabels = labelsByIssue.get(row.key) ?? [];
  const { code, name, sortKey } = parseMilestone(row.milestone);
  const openPrs = openPrsByIssue.get(row.key) ?? [];
  const devState = computeDevState(row.state, Number(row.has_active_branch ?? 0), openPrs);
  return {
    key: row.key,
    repo: row.repo,
    number: row.number,
    title: redactIssueTitle(row.title, row.key, sealedKeys),
    state: row.state,
    dev_state: devState,
    url: row.url,
    milestone: row.milestone,
    milestone_code: code,
    milestone_name: name,
    milestone_sort_key: sortKey,
    labels: issueLabels,
    priority: row.priority,
    lane: row.lane || laneFromLabels(issueLabels),
    size: row.size,
    status: row.status,
    is_stub: Boolean(row.is_stub),
    assignees: parseAssignees(row.assignees),
  };
}

function repoFromIssueKey(key: string): string | null {
  const hash = key.lastIndexOf("#");
  return hash > 0 ? key.slice(0, hash) : null;
}

export async function loadOpenPrsByIssue(
  db: D1Database,
  visible: string[],
  issueKeys?: string[],
): Promise<{ map: Map<string, PrInfo[]>; rowsRead: number }> {
  const visibleSet = new Set(visible);
  const repos =
    issueKeys && issueKeys.length > 0
      ? [...new Set(issueKeys.map(repoFromIssueKey).filter((r): r is string => r != null && visibleSet.has(r)))]
      : visible;
  if (repos.length === 0) return { map: new Map(), rowsRead: 0 };

  const ph = repos.map(() => "?").join(",");
  const prRows = await db
    .prepare(
      `SELECT closing_issue_keys, has_reviewed_label FROM pr_state WHERE state = 'open' AND repo IN (${ph})`,
    )
    .bind(...repos)
    .all<PrStateRow>();
  let rowsRead = prRows.meta?.rows_read ?? 0;
  const keyFilter =
    issueKeys && issueKeys.length > 0 ? new Set(issueKeys) : null;
  const openPrsByIssue = new Map<string, PrInfo[]>();
  for (const row of prRows.results) {
    if (!row.closing_issue_keys) continue;
    let keys: string[];
    try {
      keys = JSON.parse(row.closing_issue_keys) as string[];
    } catch {
      continue;
    }
    const prInfo: PrInfo = { has_reviewed_label: Number(row.has_reviewed_label) };
    for (const key of keys) {
      if (keyFilter && !keyFilter.has(key)) continue;
      const existing = openPrsByIssue.get(key);
      if (existing) {
        existing.push(prInfo);
      } else {
        openPrsByIssue.set(key, [prInfo]);
      }
    }
  }
  return { map: openPrsByIssue, rowsRead };
}

export async function loadLabelsForKeys(
  db: D1Database,
  keys: string[],
): Promise<{ map: Map<string, string[]>; rowsRead: number }> {
  if (keys.length === 0) return { map: new Map(), rowsRead: 0 };
  const ph = keys.map(() => "?").join(",");
  const labelRows = await db
    .prepare(`SELECT issue_key, name FROM labels WHERE issue_key IN (${ph})`)
    .bind(...keys)
    .all<LabelRow>();
  const rowsRead = labelRows.meta?.rows_read ?? 0;
  const labelsByIssue = new Map<string, string[]>();
  for (const row of labelRows.results) {
    const existing = labelsByIssue.get(row.issue_key);
    if (existing) {
      existing.push(row.name);
    } else {
      labelsByIssue.set(row.issue_key, [row.name]);
    }
  }
  return { map: labelsByIssue, rowsRead };
}

export async function loadIssuesForKeys(
  db: D1Database,
  keys: string[],
  visible: string[],
): Promise<{ rows: IssueRow[]; rowsRead: number }> {
  if (keys.length === 0) return { rows: [], rowsRead: 0 };
  const keyPh = keys.map(() => "?").join(",");
  const repoPh = visible.map(() => "?").join(",");
  const issueRows = await db
    .prepare(
      `SELECT key, repo, number, JSON_EXTRACT(payload,'$.title') AS title, state, url, milestone, lane, priority, size, status, is_stub, has_active_branch, assignees
       FROM issues WHERE key IN (${keyPh}) AND repo IN (${repoPh})`,
    )
    .bind(...keys, ...visible)
    .all<IssueRow>();
  return { rows: issueRows.results, rowsRead: issueRows.meta?.rows_read ?? 0 };
}

export async function loadEdgesForKeys(
  db: D1Database,
  keys: string[],
): Promise<{ edges: GraphEdge[]; rowsRead: number }> {
  if (keys.length === 0) return { edges: [], rowsRead: 0 };
  const ph = keys.map(() => "?").join(",");
  const edgeRows = await db
    .prepare(
      `SELECT src_key, dst_key, kind FROM edges
       WHERE src_key IN (${ph}) AND dst_key IN (${ph})`,
    )
    .bind(...keys, ...keys)
    .all<EdgeRow>();
  return {
    edges: edgeRows.results.map((row) => ({
      src: row.src_key,
      dst: row.dst_key,
      kind: row.kind,
    })),
    rowsRead: edgeRows.meta?.rows_read ?? 0,
  };
}