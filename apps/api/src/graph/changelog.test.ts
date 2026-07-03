import { describe, expect, it } from "vitest";
import { makeFakeDb, makeFakeStmt } from "../test-utils";
import {
  collectGraphChangesSince,
  graphChangelogStmts,
} from "./changelog";

describe("graph_changelog", () => {
  it("collectGraphChangesSince returns rows after cursor", async () => {
    const rows: Array<{ issue_key: string; op: string; bumped_at: string }> = [];
    const db = makeFakeDb((sql, args) => {
      if (sql.includes("INSERT OR IGNORE INTO graph_changelog")) {
        rows.push({
          issue_key: String(args?.[0]),
          bumped_at: String(args?.[1]),
          op: String(args?.[2]),
        });
        return makeFakeStmt(sql, args, [], 1);
      }
      if (sql.includes("FROM graph_changelog")) {
        const since = String(args?.[0]);
        const filtered = rows
          .filter((r) => r.bumped_at > since)
          .map((r) => ({ issue_key: r.issue_key, op: r.op }));
        return makeFakeStmt(sql, args, filtered, filtered.length);
      }
      return makeFakeStmt(sql, args, [], 0);
    });

    await db.batch(
      graphChangelogStmts(db, "2026-07-01T10:00:00.000Z", [
        { issue_key: "Roxabi/roxabi-live#1", op: "upsert" },
      ]),
    );
    await db.batch(
      graphChangelogStmts(db, "2026-07-02T10:00:00.000Z", [
        { issue_key: "Roxabi/roxabi-live#2", op: "upsert" },
        { issue_key: "Roxabi/roxabi-live#9", op: "delete" },
      ]),
    );

    const changes = await collectGraphChangesSince(db, "2026-07-01T12:00:00.000Z");
    expect(changes).toEqual([
      { issue_key: "Roxabi/roxabi-live#2", op: "upsert" },
      { issue_key: "Roxabi/roxabi-live#9", op: "delete" },
    ]);
  });
});