/**
 * GET/POST /admin/quota — operator quota view + limit overrides (#295).
 */

import type { Context } from "hono";
import {
  QUOTA_METRICS,
  type QuotaMetric,
  type TenantPlan,
  getTenantQuotaStatus,
  normalizePlan,
} from "../quota";
import { resumeSyncControl } from "../sync/control";
import type { Env } from "../types";

export async function adminQuotaGetRoute(c: Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url);
  const tenantId = Number.parseInt(url.searchParams.get("tenant_id") ?? "", 10);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return c.json({ error: "tenant_id query param required" }, 400);
  }
  const status = await getTenantQuotaStatus(c.env.DB, tenantId);
  return c.json(status);
}

interface AdminQuotaPostBody {
  tenant_id?: number;
  plan?: TenantPlan;
  reset_halt?: boolean;
  /** Set used=0 for listed metrics today (omit = all metrics). */
  reset_metrics?: QuotaMetric[];
}

export async function adminQuotaPostRoute(c: Context<{ Bindings: Env }>): Promise<Response> {
  let body: AdminQuotaPostBody;
  try {
    body = (await c.req.json()) as AdminQuotaPostBody;
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  const tenantId = body.tenant_id;
  if (tenantId == null || tenantId <= 0) {
    return c.json({ error: "tenant_id required" }, 400);
  }

  const db = c.env.DB;
  const actions: string[] = [];

  if (body.plan === "free" || body.plan === "paid") {
    await db.prepare("UPDATE tenants SET plan = ? WHERE id = ?").bind(body.plan, tenantId).run();
    actions.push(`plan=${body.plan}`);
  }

  if (body.reset_halt) {
    await resumeSyncControl(db, 0);
    actions.push("halt_reset");
  }

  if (body.reset_metrics) {
    const day = new Date().toISOString().slice(0, 10);
    for (const metric of body.reset_metrics) {
      if (!QUOTA_METRICS.includes(metric)) continue;
      await db
        .prepare(
          `INSERT INTO tenant_quota_daily (tenant_id, day, metric, used)
           VALUES (?, ?, ?, 0)
           ON CONFLICT(tenant_id, day, metric) DO UPDATE SET used = 0`,
        )
        .bind(tenantId, day, metric)
        .run();
    }
    actions.push(`reset_metrics=${body.reset_metrics.join(",")}`);
  }

  const status = await getTenantQuotaStatus(
    db,
    tenantId,
    body.plan ? normalizePlan(body.plan) : undefined,
  );
  return c.json({ ok: true, actions, status });
}
