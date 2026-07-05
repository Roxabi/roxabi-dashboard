/**
 * Per-tenant daily quota limits keyed by plan (#295).
 * Values: packages/shared/config/runtime.json
 */

export type {
  QuotaMetric,
  QuotaPlanLimits,
  TenantPlan,
} from "@roxabi-live/shared";
export {
  QUOTA_METRICS,
  normalizeTenantPlan as normalizePlan,
  quotaLimitForMetric as limitForMetric,
  quotaLimitsForPlan as limitsForPlan,
} from "@roxabi-live/shared";