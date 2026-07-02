/**
 * Graph/issues read-path quota enforcement (#295).
 */

import type { Context } from "hono";
import type { AuthEnv } from "../auth/types";
import { getQuotaUsed, spendQuotaClamped } from "./ledger";
import { type TenantPlan, limitForMetric } from "./limits";

/** Conservative lower bound for one full graph rebuild @ ~5k issues. */
export const MIN_GRAPH_REBUILD_ROWS = 25_000;

export function graphQuotaDeniedResponse(c: Context<AuthEnv>): Response {
  const retryAfter = secondsUntilUtcMidnight();
  return c.json({ error: "quota_exceeded", metric: "graph_rows", retry_after: retryAfter }, 429, {
    "Retry-After": String(retryAfter),
  });
}

/** Gate before expensive corpus scans — deny when exhausted or insufficient headroom. */
export async function reserveGraphRowsBudget(
  db: D1Database,
  tenantId: number,
  plan: TenantPlan,
): Promise<boolean> {
  const used = await getQuotaUsed(db, tenantId, "graph_rows");
  const limit = limitForMetric(plan, "graph_rows");
  return used < limit && limit - used >= MIN_GRAPH_REBUILD_ROWS;
}

export async function recordGraphRowsSpend(
  db: D1Database,
  tenantId: number,
  rowsRead: number,
  plan: TenantPlan,
): Promise<boolean> {
  if (rowsRead <= 0) return true;
  const { ok } = await spendQuotaClamped(db, tenantId, "graph_rows", rowsRead, plan);
  return ok;
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.ceil((midnight - now.getTime()) / 1000));
}

/** Sum rows_read from a batch of D1 results. */
export function sumRowsRead(results: Array<{ meta?: { rows_read?: number } }>): number {
  return results.reduce((sum, r) => sum + (r.meta?.rows_read ?? 0), 0);
}
