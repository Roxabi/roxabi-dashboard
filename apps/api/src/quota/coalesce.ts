/**
 * Lossless webhook deferral — mark repos dirty for later reconcile (#295 S3).
 */

/** Clear sync watermark so bootstrap/maintenance picks the repo up again. */
export async function markRepoDirty(db: D1Database, repo: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_state (repo, last_cursor, last_synced_at)
       VALUES (?, '', NULL)
       ON CONFLICT(repo) DO UPDATE SET last_synced_at = NULL`,
    )
    .bind(repo)
    .run();
}

const BRANCH_SCAN_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Returns true when a full branch re-scan should run now; false when debounced
 * (repo marked dirty instead).
 */
export async function shouldRunBranchRescan(db: D1Database, repo: string): Promise<boolean> {
  const key = `branch_scan:${repo}`;
  const now = new Date().toISOString();
  const row = await db
    .prepare("SELECT value FROM sync_control WHERE tenant_id = 0 AND key = ?")
    .bind(key)
    .first<{ value: string }>();

  if (row?.value) {
    const last = Date.parse(row.value);
    if (Number.isFinite(last) && Date.now() - last < BRANCH_SCAN_DEBOUNCE_MS) {
      await markRepoDirty(db, repo);
      return false;
    }
  }

  await db
    .prepare(
      `INSERT INTO sync_control (tenant_id, key, value, updated_at)
       VALUES (0, ?, ?, ?)
       ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, now, now)
    .run();
  return true;
}
