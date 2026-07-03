/**
 * Corpus version token — MAX(sync_state.last_synced_at, data_version).
 * Shared by /api/version and /api/graph delta gating.
 */

const CORPUS_VERSION_SQL = `SELECT MAX(v) AS version FROM (
  SELECT COALESCE(MAX(last_synced_at), '') AS v FROM sync_state
  UNION ALL
  SELECT COALESCE(value, '') AS v FROM sync_control WHERE key = 'data_version' AND tenant_id = 0
)`;

export async function getCorpusVersion(db: D1Database): Promise<string> {
  const row = await db.prepare(CORPUS_VERSION_SQL).first<{ version: string | null }>();
  return row?.version ?? "";
}