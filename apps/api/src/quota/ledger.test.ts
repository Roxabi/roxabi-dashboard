import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getTenantQuotaStatus, spendQuota, spendQuotaClamped } from "./ledger";

function sqliteAsD1(db: Database.Database): D1Database {
  const wrap = (sql: string, args: unknown[] = []) => {
    const stmt = db.prepare(sql);
    return {
      run: async () => {
        const info = stmt.run(...args);
        return { meta: { changes: info.changes, rows_read: 0, rows_written: info.changes } };
      },
      first: async <T>() => (stmt.get(...args) as T | undefined) ?? null,
      all: async <T>() => ({ results: stmt.all(...args) as T[], meta: { rows_read: 0 } }),
    };
  };

  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return wrap(sql, args);
        },
        ...wrap(sql),
      };
    },
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => {
      await Promise.all(stmts.map((s) => s.run()));
      return [];
    },
  } as unknown as D1Database;
}

function seedQuotaSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'free');
    CREATE TABLE tenant_quota_daily (
      tenant_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      metric TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, day, metric)
    );
    INSERT INTO tenants (id, plan) VALUES (1, 'free'), (2, 'paid');
  `);
}

describe("quota ledger", () => {
  it("spendQuota accepts within limit and rejects over budget", async () => {
    const sqlite = new Database(":memory:");
    seedQuotaSchema(sqlite);
    const db = sqliteAsD1(sqlite);

    expect(await spendQuota(db, 1, "webhook_events", 1, "free", true)).toBe(true);
    expect(await spendQuota(db, 1, "webhook_events", 499, "free", true)).toBe(true);
    expect(await spendQuota(db, 1, "webhook_events", 1, "free", true)).toBe(false);

    const status = await getTenantQuotaStatus(db, 1, "free");
    const webhook = status.metrics.find((m) => m.metric === "webhook_events");
    expect(webhook?.used).toBe(500);
    expect(webhook?.exhausted).toBe(true);
  });

  it("spendQuotaClamped records partial spend toward exhausted", async () => {
    const sqlite = new Database(":memory:");
    seedQuotaSchema(sqlite);
    const db = sqliteAsD1(sqlite);

    await spendQuota(db, 1, "graph_rows", 120_000, "free", true);
    const partial = await spendQuotaClamped(db, 1, "graph_rows", 10_000, "free");
    expect(partial.ok).toBe(false);
    expect(partial.spent).toBe(5_000);

    const status = await getTenantQuotaStatus(db, 1, "free");
    const graph = status.metrics.find((m) => m.metric === "graph_rows");
    expect(graph?.used).toBe(125_000);
    expect(graph?.exhausted).toBe(true);
  });

  it("paid plan has higher graph_rows limit", async () => {
    const sqlite = new Database(":memory:");
    seedQuotaSchema(sqlite);
    const db = sqliteAsD1(sqlite);
    expect(await spendQuota(db, 2, "graph_rows", 200_000, "paid", true)).toBe(true);
    const status = await getTenantQuotaStatus(db, 2, "paid");
    const graph = status.metrics.find((m) => m.metric === "graph_rows");
    expect(graph?.limit).toBe(2_500_000);
  });
});
