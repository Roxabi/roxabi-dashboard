/**
 * Poll /api/quota for tenant daily budget state (#295).
 */

import { apiFetch } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export type QuotaMetric =
  | "webhook_events"
  | "gh_fetches"
  | "graph_rows"
  | "sync_writes"
  | "sync_pages";

export interface QuotaMetricStatus {
  metric: QuotaMetric;
  used: number;
  limit: number;
  exhausted: boolean;
}

export interface TenantQuotaStatus {
  tenant_id: number;
  plan: "free" | "paid";
  day: string;
  metrics: QuotaMetricStatus[];
  any_exhausted: boolean;
}

const QUOTA_POLL_MS = 60_000;

export function useQuotaStatus() {
  return useQuery({
    queryKey: ["quota"],
    queryFn: () => apiFetch<TenantQuotaStatus>("/api/quota"),
    refetchInterval: QUOTA_POLL_MS,
    retry: false,
  });
}