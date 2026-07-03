import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { getQuotaUsed, spendQuota, spendQuotaClamped } from "./ledger";
import { limitForMetric } from "./limits";
import {
  MIN_GRAPH_REBUILD_ROWS,
  recordGraphRowsSpend,
  reserveGraphRowsBudget,
} from "./read-budget";

const FREE_GRAPH_ROWS = limitForMetric("free", "graph_rows");

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

function seedSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, plan TEXT NOT NULL DEFAULT 'free');
    CREATE TABLE tenant_quota_daily (
      tenant_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      metric TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, day, metric)
    );
    INSERT INTO tenants (id, plan) VALUES (1, 'free');
  `);
}

describe("quota enforcement integration", () => {
  it("reserveGraphRowsBudget denies when headroom below MIN_GRAPH_REBUILD_ROWS", async () => {
    const sqlite = new Database(":memory:");
    seedSchema(sqlite);
    const d1 = sqliteAsD1(sqlite);

    await spendQuota(d1, 1, "graph_rows", FREE_GRAPH_ROWS - MIN_GRAPH_REBUILD_ROWS + 1, "free", true);

    await expect(reserveGraphRowsBudget(d1, 1, "free")).resolves.toBe(false);
    await expect(reserveGraphRowsBudget(d1, 1, "free")).resolves.toBe(false);
  });

  it("recordGraphRowsSpend clamps partial usage until exhausted", async () => {
    const sqlite = new Database(":memory:");
    seedSchema(sqlite);
    const d1 = sqliteAsD1(sqlite);

    await spendQuota(d1, 1, "graph_rows", 120_000, "free", true);
    await expect(recordGraphRowsSpend(d1, 1, 10_000, "free")).resolves.toBe(false);

    const used = await getQuotaUsed(d1, 1, "graph_rows");
    expect(used).toBe(FREE_GRAPH_ROWS);

    const { ok } = await spendQuotaClamped(d1, 1, "graph_rows", 1, "free");
    expect(ok).toBe(false);
    expect(await getQuotaUsed(d1, 1, "graph_rows")).toBe(FREE_GRAPH_ROWS);
  });
});