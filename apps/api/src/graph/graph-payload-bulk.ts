/**
 * Bulk D1 loaders for full-graph scans and repo summaries.
 * Split out of graph-payload-loaders.ts (file-length gate).
 */

import type { GraphEdge, RepoSummary } from "./graph-payload-types";

interface LabelRow {
  issue_key: string;
  name: string;
}

export interface IssueRow {
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

export async function loadFullGraphRows(
  db: D1Database,
  visible: string[],
): Promise<{
  issueRows: IssueRow[];
  labelsByIssue: Map<string, string[]>;
  edges: GraphEdge[];
  rowsRead: number;
}> {
  const ph = visible.map(() => "?").join(",");
  let rowsRead = 0;

  const labelRows = await db
    .prepare(
      `SELECT issue_key, name FROM labels WHERE issue_key IN (SELECT key FROM issues WHERE repo IN (${ph}))`,
    )
    .bind(...visible)
    .all<LabelRow>();
  rowsRead += labelRows.meta?.rows_read ?? 0;
  const labelsByIssue = new Map<string, string[]>();
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
  const issueRows = issueResult.results;
  rowsRead += issueResult.meta?.rows_read ?? 0;

  const edgeRows = await db
    .prepare(
      `SELECT e.src_key, e.dst_key, e.kind
       FROM edges e
       INNER JOIN issues si ON si.key = e.src_key
       INNER JOIN issues di ON di.key = e.dst_key
       WHERE si.repo IN (${ph}) AND di.repo IN (${ph})`,
    )
    .bind(...visible, ...visible)
    .all<EdgeRow>();
  rowsRead += edgeRows.meta?.rows_read ?? 0;
  const edges = edgeRows.results.map((row) => ({
    src: row.src_key,
    dst: row.dst_key,
    kind: row.kind,
  }));

  return { issueRows, labelsByIssue, edges, rowsRead };
}

export async function loadRepos(
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