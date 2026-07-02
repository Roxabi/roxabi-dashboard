/**
 * Graph/issues read-path quota enforcement (#295).
 */

import type { Context } from "hono";
import type { AuthEnv } from "../auth/types";
import { getTenantPlan, spendQuota } from "./ledger";

export async function enforceGraphRowsBudget(
  c: Context<AuthEnv>,
  rowsRead: number,
): Promise<Response | null> {
  const session = c.get("session");
  if (!session?.tenantId || rowsRead <= 0) return null;

  const plan = await getTenantPlan(c.env.DB, session.tenantId);
  const ok = await spendQuota(c.env.DB, session.tenantId, "graph_rows", rowsRead, plan, true);
  if (ok) return null;

  const retryAfter = secondsUntilUtcMidnight();
  return c.json({ error: "quota_exceeded", metric: "graph_rows", retry_after: retryAfter }, 429, {
    "Retry-After": String(retryAfter),
  });
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
