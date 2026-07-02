/**
 * D1-backed per-tenant daily quota ledger (#295).
 * Check-and-spend uses the same meta.changes idiom as acquireSyncLock.
 */

import {
  QUOTA_METRICS,
  type QuotaMetric,
  type TenantPlan,
  limitForMetric,
  normalizePlan,
} from "./limits";

export interface QuotaMetricStatus {
  metric: QuotaMetric;
  used: number;
  limit: number;
  exhausted: boolean;
}

export interface TenantQuotaStatus {
  tenant_id: number;
  plan: TenantPlan;
  day: string;
  metrics: QuotaMetricStatus[];
  any_exhausted: boolean;
}

/** UTC calendar day for quota rollover (matches Cloudflare free-tier reset). */
export function utcQuotaDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function getTenantPlan(db: D1Database, tenantId: number): Promise<TenantPlan> {
  const row = await db
    .prepare("SELECT plan FROM tenants WHERE id = ?")
    .bind(tenantId)
    .first<{ plan: string }>();
  return normalizePlan(row?.plan);
}

async function seedQuotaRow(
  db: D1Database,
  tenantId: number,
  day: string,
  metric: QuotaMetric,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO tenant_quota_daily (tenant_id, day, metric, used)
       VALUES (?, ?, ?, 0)`,
    )
    .bind(tenantId, day, metric)
    .run();
}

export async function getQuotaUsed(
  db: D1Database,
  tenantId: number,
  metric: QuotaMetric,
  day = utcQuotaDay(),
): Promise<number> {
  await seedQuotaRow(db, tenantId, day, metric);
  const row = await db
    .prepare(
      `SELECT used FROM tenant_quota_daily
       WHERE tenant_id = ? AND day = ? AND metric = ?`,
    )
    .bind(tenantId, day, metric)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

/**
 * Atomically spend quota. Returns true when spend accepted, false when over budget.
 * When enforce=false, always records usage and returns true (S1 meter-only).
 */
export async function spendQuota(
  db: D1Database,
  tenantId: number,
  metric: QuotaMetric,
  amount: number,
  plan: TenantPlan,
  enforce = true,
): Promise<boolean> {
  if (amount <= 0) return true;
  const day = utcQuotaDay();
  const limit = limitForMetric(plan, metric);
  await seedQuotaRow(db, tenantId, day, metric);

  if (!enforce) {
    await db
      .prepare(
        `UPDATE tenant_quota_daily SET used = used + ?
         WHERE tenant_id = ? AND day = ? AND metric = ?`,
      )
      .bind(amount, tenantId, day, metric)
      .run();
    return true;
  }

  const result = await db
    .prepare(
      `UPDATE tenant_quota_daily SET used = used + ?
       WHERE tenant_id = ? AND day = ? AND metric = ?
         AND used + ? <= ?`,
    )
    .bind(amount, tenantId, day, metric, amount, limit)
    .run();
  return result.meta.changes > 0;
}

export async function getTenantQuotaStatus(
  db: D1Database,
  tenantId: number,
  plan?: TenantPlan,
): Promise<TenantQuotaStatus> {
  const resolvedPlan = plan ?? (await getTenantPlan(db, tenantId));
  const day = utcQuotaDay();
  const metrics: QuotaMetricStatus[] = [];

  for (const metric of QUOTA_METRICS) {
    const used = await getQuotaUsed(db, tenantId, metric, day);
    const limit = limitForMetric(resolvedPlan, metric);
    metrics.push({
      metric,
      used,
      limit,
      exhausted: used >= limit,
    });
  }

  return {
    tenant_id: tenantId,
    plan: resolvedPlan,
    day,
    metrics,
    any_exhausted: metrics.some((m) => m.exhausted),
  };
}
