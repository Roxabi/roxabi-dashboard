/**
 * Per-tenant daily quota limits keyed by plan (#295).
 * Sized for ~20 active free tenants staying within Workers Paid included pools.
 */

export type TenantPlan = "free" | "paid";

export type QuotaMetric =
  | "webhook_events"
  | "gh_fetches"
  | "graph_rows"
  | "sync_writes"
  | "sync_pages";

export const QUOTA_METRICS: readonly QuotaMetric[] = [
  "webhook_events",
  "gh_fetches",
  "graph_rows",
  "sync_writes",
  "sync_pages",
] as const;

const FREE_LIMITS: Record<QuotaMetric, number> = {
  webhook_events: 500,
  gh_fetches: 150,
  graph_rows: 125_000,
  sync_writes: 1_250,
  sync_pages: 50,
};

const PAID_LIMITS: Record<QuotaMetric, number> = {
  webhook_events: 5_000,
  gh_fetches: 1_500,
  graph_rows: 2_500_000,
  sync_writes: 25_000,
  sync_pages: 500,
};

export function limitsForPlan(plan: TenantPlan): Record<QuotaMetric, number> {
  return plan === "paid" ? PAID_LIMITS : FREE_LIMITS;
}

export function limitForMetric(plan: TenantPlan, metric: QuotaMetric): number {
  return limitsForPlan(plan)[metric];
}

export function normalizePlan(raw: string | null | undefined): TenantPlan {
  return raw === "paid" ? "paid" : "free";
}
