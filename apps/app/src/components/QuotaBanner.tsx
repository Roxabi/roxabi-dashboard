import { useQuotaStatus, type QuotaMetric } from "@/hooks/useQuotaStatus";
import { useT } from "@/i18n";

function exhaustedMetrics(metrics: { metric: QuotaMetric; exhausted: boolean }[]): QuotaMetric[] {
  return metrics.filter((m) => m.exhausted).map((m) => m.metric);
}

/**
 * Tenant-visible quota degradation banner (#295).
 */
export function QuotaBanner() {
  const t = useT();
  const { data } = useQuotaStatus();
  if (!data?.any_exhausted) return null;

  const exhausted = exhaustedMetrics(data.metrics);
  const graphLimited = exhausted.includes("graph_rows");
  const webhookLimited = exhausted.includes("webhook_events") || exhausted.includes("gh_fetches");
  const syncLimited = exhausted.includes("sync_pages") || exhausted.includes("sync_writes");

  let message = t("quota.generic");
  if (webhookLimited && !graphLimited && !syncLimited) {
    message = t("quota.deferred");
  } else if (syncLimited && !graphLimited) {
    message = t("quota.syncPaused");
  } else if (graphLimited) {
    message = t("quota.readLimited");
  }

  return (
    <div
      role="status"
      data-testid="quota-banner"
      className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-foreground"
    >
      <strong>{t("quota.title")}</strong>
      <span className="ml-2 text-muted-foreground">{message}</span>
      {data.plan === "free" ? (
        <span className="ml-2 text-muted-foreground">({t("quota.resetHint")})</span>
      ) : null}
    </div>
  );
}