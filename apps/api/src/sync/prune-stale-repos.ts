/**
 * Prune D1 rows for repos no longer in the tenant discovery union.
 * Split out of sync.ts (file-length gate).
 */

import { batchChunked } from "./control";

/** Delete corpus rows for repos absent from the current discovery union. */
export async function pruneStaleRepoData(db: D1Database, knownRepos: Set<string>): Promise<number> {
  const CHUNK = 90;

  const [issueRepos, edgeSrcRepos, edgeDstRepos, prStateRepos, syncStateRepos, registryRepos] =
    await Promise.all([
      db.prepare("SELECT DISTINCT repo FROM issues").all<{ repo: string }>(),
      db
        .prepare("SELECT DISTINCT substr(src_key, 1, instr(src_key,'#')-1) AS repo FROM edges")
        .all<{ repo: string }>(),
      db
        .prepare("SELECT DISTINCT substr(dst_key, 1, instr(dst_key,'#')-1) AS repo FROM edges")
        .all<{ repo: string }>(),
      db.prepare("SELECT DISTINCT repo FROM pr_state").all<{ repo: string }>(),
      db.prepare("SELECT repo FROM sync_state").all<{ repo: string }>(),
      db.prepare("SELECT repo FROM repos").all<{ repo: string }>(),
    ]);

  const staleIssueRepos = (issueRepos.results ?? [])
    .map((r) => r.repo)
    .filter((r) => !knownRepos.has(r));
  const staleEdgeRepos = [
    ...(edgeSrcRepos.results ?? []).map((r) => r.repo),
    ...(edgeDstRepos.results ?? []).map((r) => r.repo),
  ].filter((r) => !knownRepos.has(r));
  const stalePrStateRepos = (prStateRepos.results ?? [])
    .map((r) => r.repo)
    .filter((r) => !knownRepos.has(r));
  const staleSyncStateRepos = (syncStateRepos.results ?? [])
    .map((r) => r.repo)
    .filter((r) => !knownRepos.has(r));
  const staleRegistryRepos = (registryRepos.results ?? [])
    .map((r) => r.repo)
    .filter((r) => !knownRepos.has(r));

  const pruneStmts: D1PreparedStatement[] = [];
  for (let i = 0; i < staleIssueRepos.length; i += CHUNK) {
    for (const repo of staleIssueRepos.slice(i, i + CHUNK)) {
      pruneStmts.push(db.prepare("DELETE FROM issues WHERE repo=?").bind(repo));
    }
  }
  const staleEdgeReposUniq = [...new Set(staleEdgeRepos)];
  for (let i = 0; i < staleEdgeReposUniq.length; i += CHUNK) {
    for (const repo of staleEdgeReposUniq.slice(i, i + CHUNK)) {
      pruneStmts.push(
        db
          .prepare(
            "DELETE FROM edges WHERE substr(src_key,1,instr(src_key,'#')-1)=? OR substr(dst_key,1,instr(dst_key,'#')-1)=?",
          )
          .bind(repo, repo),
      );
    }
  }
  for (let i = 0; i < stalePrStateRepos.length; i += CHUNK) {
    for (const repo of stalePrStateRepos.slice(i, i + CHUNK)) {
      pruneStmts.push(db.prepare("DELETE FROM pr_state WHERE repo=?").bind(repo));
    }
  }
  for (let i = 0; i < staleSyncStateRepos.length; i += CHUNK) {
    for (const repo of staleSyncStateRepos.slice(i, i + CHUNK)) {
      pruneStmts.push(db.prepare("DELETE FROM sync_state WHERE repo=?").bind(repo));
    }
  }
  for (const repo of staleRegistryRepos) {
    pruneStmts.push(db.prepare("DELETE FROM repos WHERE repo=?").bind(repo));
  }

  if (pruneStmts.length === 0) return 0;

  await batchChunked(db, pruneStmts);
  return new Set([
    ...staleIssueRepos,
    ...staleEdgeReposUniq,
    ...stalePrStateRepos,
    ...staleSyncStateRepos,
    ...staleRegistryRepos,
  ]).size;
}
