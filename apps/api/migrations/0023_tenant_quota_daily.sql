-- Per-tenant daily compute quota ledger (#295).
-- Resets align with UTC midnight via the `day` column (YYYY-MM-DD).

CREATE TABLE IF NOT EXISTS tenant_quota_daily (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  day       TEXT    NOT NULL,
  metric    TEXT    NOT NULL,
  used      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day, metric)
);

CREATE INDEX IF NOT EXISTS idx_tenant_quota_daily_day ON tenant_quota_daily(day);

ALTER TABLE tenants ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';