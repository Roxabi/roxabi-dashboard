/**
 * graph_changelog — records issue-level graph mutations for delta fetches.
 */

export type GraphChangeOp = "upsert" | "delete";

export interface GraphChangeRow {
  issue_key: string;
  op: GraphChangeOp;
}

/** Prepare INSERT statements for one or more issue keys. */
export function graphChangelogStmts(
  db: D1Database,
  bumpedAt: string,
  changes: Array<{ issue_key: string; op?: GraphChangeOp }>,
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [];
  for (const { issue_key, op = "upsert" } of changes) {
    if (!issue_key) continue;
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO graph_changelog (issue_key, bumped_at, op)
           VALUES (?, ?, ?)`,
        )
        .bind(issue_key, bumpedAt, op),
    );
  }
  return stmts;
}

/** Stamp every issue in a repo (branch sync resets has_active_branch). */
export function graphChangelogForRepoStmt(
  db: D1Database,
  repo: string,
  bumpedAt: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO graph_changelog (issue_key, bumped_at, op)
       SELECT key, ?, 'upsert' FROM issues WHERE repo = ?`,
    )
    .bind(bumpedAt, repo);
}

/** Stamp issues whose milestone title matches (milestone rename). */
export function graphChangelogForRepoMilestoneStmt(
  db: D1Database,
  repo: string,
  milestone: string,
  bumpedAt: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO graph_changelog (issue_key, bumped_at, op)
       SELECT key, ?, 'upsert' FROM issues WHERE repo = ? AND milestone = ?`,
    )
    .bind(bumpedAt, repo, milestone);
}

/** Issues upserted during a sync page (bulk, one stmt per repo batch). */
export function graphChangelogForRepoSinceStmt(
  db: D1Database,
  repo: string,
  sinceIso: string,
  bumpedAt: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO graph_changelog (issue_key, bumped_at, op)
       SELECT key, ?, 'upsert' FROM issues WHERE repo = ? AND updated_at >= ?`,
    )
    .bind(bumpedAt, repo, sinceIso);
}

export async function collectGraphChangesSince(
  db: D1Database,
  since: string,
): Promise<GraphChangeRow[]> {
  const result = await db
    .prepare(
      `SELECT issue_key, op FROM graph_changelog
       WHERE bumped_at > ?
       ORDER BY bumped_at ASC`,
    )
    .bind(since)
    .all<GraphChangeRow>();
  return result.results ?? [];
}

/** Drop entries older than N days (best-effort housekeeping). */
export async function pruneGraphChangelog(db: D1Database, keepDays = 14): Promise<void> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  await db
    .prepare(`DELETE FROM graph_changelog WHERE bumped_at < ?`)
    .bind(cutoff)
    .run();
}