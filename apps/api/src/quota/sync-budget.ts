/**
 * Sync/bootstrap quota gates (#295).
 */

import { getQuotaUsed, getTenantPlan, spendQuota } from "./ledger";
import { limitForMetric } from "./limits";

export async function isSyncBudgetExhausted(db: D1Database, tenantId: number): Promise<boolean> {
  const plan = await getTenantPlan(db, tenantId);
  const pagesUsed = await getQuotaUsed(db, tenantId, "sync_pages");
  return pagesUsed >= limitForMetric(plan, "sync_pages");
}

export async function trySpendSyncPage(db: D1Database, tenantId: number): Promise<boolean> {
  const plan = await getTenantPlan(db, tenantId);
  return spendQuota(db, tenantId, "sync_pages", 1, plan, true);
}

export async function recordSyncWrites(
  db: D1Database,
  tenantId: number,
  rowsWritten: number,
): Promise<boolean> {
  if (rowsWritten <= 0) return true;
  const plan = await getTenantPlan(db, tenantId);
  return spendQuota(db, tenantId, "sync_writes", rowsWritten, plan, true);
}
