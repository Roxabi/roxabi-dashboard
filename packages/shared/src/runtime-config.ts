/**
 * Runtime tunables — loaded from packages/shared/config/runtime.json (SSOT).
 * Edit the JSON to change limits, quotas, and poll intervals without touching TS.
 */

import raw from "../config/runtime.json";

export type TenantPlan = "free" | "paid";

export type QuotaMetric =
  | "webhook_events"
  | "gh_fetches"
  | "graph_rows"
  | "sync_writes"
  | "sync_pages";

export interface QuotaPlanLimits {
  webhook_events: number;
  gh_fetches: number;
  graph_rows: number;
  sync_writes: number;
  sync_pages: number;
}

export interface RuntimeConfig {
  quota: {
    plans: Record<TenantPlan, QuotaPlanLimits>;
    graphRead: {
      minFullRebuildHeadroomRows: number;
      minDeltaHeadroomRows: number;
    };
  };
  graph: {
    maxDeltaKeys: number;
    changelogKeepDays: number;
  };
  sync: {
    maxPages: number;
    window: number;
    bootstrapWindow: number;
    numSlots: number;
    maxDiscoveryProbesPerPass: number;
    branchScanDebounceMs: number;
  };
  client: {
    pollIntervalMs: {
      version: number;
      syncStatus: number;
      quota: number;
    };
    graphQueryStaleTimeMs: number;
  };
}

export const runtimeConfig: RuntimeConfig = raw as RuntimeConfig;

export const QUOTA_METRICS: readonly QuotaMetric[] = [
  "webhook_events",
  "gh_fetches",
  "graph_rows",
  "sync_writes",
  "sync_pages",
] as const;

export function quotaLimitsForPlan(plan: TenantPlan): QuotaPlanLimits {
  return runtimeConfig.quota.plans[plan];
}

export function quotaLimitForMetric(plan: TenantPlan, metric: QuotaMetric): number {
  return runtimeConfig.quota.plans[plan][metric];
}

export function normalizeTenantPlan(raw: string | null | undefined): TenantPlan {
  return raw === "paid" ? "paid" : "free";
}