/**
 * Shared graph corpus assembly for full and delta /api/graph responses.
 */

import { redactIssueTitle } from "../auth/zk";
import { filterNodesByStatus, type GraphStatus } from "../graph/status";
import { parseMilestone } from "../sync/parse";

const LANE_LABEL_PREFIX = "graph:lane/";

export type DevState = "idle" | "dev" | "pr_open" | "pr_reviewed";

export interface GraphNode {
  key: string;
  repo: string;
  number: number;
  title: string | null;
  state: string;
  dev_state: DevState;
  url: string | null;
  milestone: string | null;
  milestone_code: string | null;
  milestone_name: string | null;
  milestone_sort_key: number;
  labels: string[];
  priority: string | null;
  lane: string | null;
  size: string | null;
  status: string | null;
  is_stub: boolean;
  assignees: string[];
}

export interface GraphEdge {
  src: string;
  dst: string;
  kind: string;
}

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

interface IssueRow {
  key: string;
  repo: string;
  number: number;
  title: string | null;
  state: string;
  url: string | null;
  milestone: string | null;
  lane: string | null;
  priority: string | null;
  size: string | null;
  status: string | null;
  is_stub: number;
  has_active_branch: number;
  assignees: string | null;
}

interface EdgeRow {
  src_key: string;
  dst_key: string;
  kind: string;
}

export interface RepoSummary {
  repo: string;
  archived: boolean;
  is_private: boolean;
  issue_count: number;
  last_updated_at: string | null;
}

export interface GraphBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  repos: RepoSummary[];
  rowsRead: number;
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

function issueRowToNode(
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

async function loadOpenPrsByIssue(
  db: D1Database,
  visible: string[],
): Promise<{ map: Map<string, PrInfo[]>; rowsRead: number }> {
  const ph = visible.map(() => "?").join(",");
  const prRows = await db
    .prepare(
      `SELECT closing_issue_keys, has_reviewed_label FROM pr_state WHERE state = 'open' AND repo IN (${ph})`,
    )
    .bind(...visible)
    .all<PrStateRow>();
  let rowsRead = prRows.meta?.rows_read ?? 0;
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

async function loadLabelsForKeys(
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

async function loadIssuesForKeys(
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

async function loadEdgesForKeys(
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

async function loadRepos(
  db: D1Database,
  visible: string[],
  tenantId: number | null,
  repoFilter?: string[],
): Promise<{ repos: RepoSummary[]; rowsRead: number }> {
  const targetRepos = repoFilter?.length ? repoFilter.filter((r) => visible.includes(r)) : visible;
  if (targetRepos.length === 0) return { repos: [], rowsRead: 0 };

  const ph = targetRepos.map(() => "?").join(",");
  interface RepoRow {
    repo: string;
    archived: number;
    is_private: number;
  }
  interface RepoActivityRow {
    repo: string;
    issue_count: number;
    last_updated_at: string | null;
  }
  const [repoRows, activityRows] = await Promise.all([
    db
      .prepare(
        `SELECT r.repo, r.archived, COALESCE(tra.is_private, 1) AS is_private
         FROM repos r
         LEFT JOIN tenant_repo_access tra
           ON tra.tenant_id = ? AND tra.repo = r.repo
         WHERE r.repo IN (${ph})`,
      )
      .bind(tenantId, ...targetRepos)
      .all<RepoRow>(),
    db
      .prepare(
        `SELECT repo, COUNT(*) AS issue_count, MAX(updated_at) AS last_updated_at
         FROM issues WHERE repo IN (${ph}) GROUP BY repo`,
      )
      .bind(...targetRepos)
      .all<RepoActivityRow>(),
  ]);
  const rowsRead = (repoRows.meta?.rows_read ?? 0) + (activityRows.meta?.rows_read ?? 0);
  const activityByRepo = new Map((activityRows.results ?? []).map((row) => [row.repo, row]));
  const repos = (repoRows.results ?? []).map((r) => {
    const activity = activityByRepo.get(r.repo);
    return {
      repo: r.repo,
      archived: Boolean(r.archived),
      is_private: Number(r.is_private) !== 0,
      issue_count: activity?.issue_count ?? 0,
      last_updated_at: activity?.last_updated_at ?? null,
    };
  });
  return { repos, rowsRead };
}

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
       WHERE (e.src_key IN (${ph}) OR e.dst_key IN (${ph}))
         AND e.src_key IN (SELECT key FROM issues WHERE repo IN (${repoPh}))
         AND e.dst_key IN (SELECT key FROM issues WHERE repo IN (${repoPh}))`,
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

  const { map: openPrsByIssue, rowsRead: prRows } = await loadOpenPrsByIssue(db, visible);
  rowsRead += prRows;

  let issueRows: IssueRow[];
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
    const ph = visible.map(() => "?").join(",");
    const labelRows = await db
      .prepare(
        `SELECT issue_key, name FROM labels WHERE issue_key IN (SELECT key FROM issues WHERE repo IN (${ph}))`,
      )
      .bind(...visible)
      .all<LabelRow>();
    rowsRead += labelRows.meta?.rows_read ?? 0;
    labelsByIssue = new Map<string, string[]>();
    for (const row of labelRows.results) {
      const existing = labelsByIssue.get(row.issue_key);
      if (existing) {
        existing.push(row.name);
      } else {
        labelsByIssue.set(row.issue_key, [row.name]);
      }
    }

    const issueResult = await db
      .prepare(
        `SELECT key, repo, number, JSON_EXTRACT(payload,'$.title') AS title, state, url, milestone, lane, priority, size, status, is_stub, has_active_branch, assignees FROM issues WHERE repo IN (${ph})`,
      )
      .bind(...visible)
      .all<IssueRow>();
    issueRows = issueResult.results;
    rowsRead += issueResult.meta?.rows_read ?? 0;

    const edgeRows = await db
      .prepare(
        `SELECT src_key, dst_key, kind FROM edges WHERE src_key IN (SELECT key FROM issues WHERE repo IN (${ph})) AND dst_key IN (SELECT key FROM issues WHERE repo IN (${ph}))`,
      )
      .bind(...visible, ...visible)
      .all<EdgeRow>();
    rowsRead += edgeRows.meta?.rows_read ?? 0;
    edges = edgeRows.results.map((row) => ({
      src: row.src_key,
      dst: row.dst_key,
      kind: row.kind,
    }));
  }

  let nodes: GraphNode[] = issueRows.map((row) =>
    issueRowToNode(row, labelsByIssue, openPrsByIssue, sealedKeys),
  );

  if (statusFilter !== null) {
    nodes = filterNodesByStatus(nodes, edges, statusFilter, { closedUnderOpenEpic });
    const nodeKeys = new Set(nodes.map((n) => n.key));
    edges = edges.filter((e) => nodeKeys.has(e.src) && nodeKeys.has(e.dst));
  }

  const repoFilter = keys
    ? [...new Set(nodes.map((n) => n.repo))]
    : undefined;
  const repoResult = await loadRepos(db, visible, tenantId, repoFilter);
  rowsRead += repoResult.rowsRead;

  return { nodes, edges, repos: repoResult.repos, rowsRead };
}