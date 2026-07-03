/**
 * GET /api/graph — v6 graph payload (nodes + edges).
 *
 * Full fetch: scans visible repos. Delta fetch (?since=<version>): reads only
 * issues touched since that corpus version via graph_changelog (#295 follow-up).
 */

import type { Context } from "hono";
import { resolveVisibleRepos } from "../auth/repoAccess";
import type { AuthEnv } from "../auth/types";
import { loadZkSealedIssueKeysForUser } from "../auth/zk";
import { buildGraphPayload, expandGraphKeys } from "../graph/build-payload";
import { collectGraphChangesSince } from "../graph/changelog";
import {
  parseClosedUnderOpenEpicQuery,
  parseStatusQuery,
} from "../graph/status";
import { getCorpusVersion } from "../graph/corpus-version";
import {
  computeEtag,
  etagMatches,
  getTenantPlan,
  sealVersionForKeys,
} from "../quota";
import {
  graphQuotaDeniedResponse,
  MIN_DELTA_GRAPH_ROWS,
  recordGraphRowsSpend,
  reserveGraphRowsBudget,
} from "../quota/read-budget";

/** Max dirty issues before falling back to a full rebuild. */
export const MAX_DELTA_KEYS = 400;

export type DevState = "idle" | "dev" | "pr_open" | "pr_reviewed";

export interface Node {
  key: string;
  repo: string;
  number: number;
  title: string | null;
  state: string;
  dev_state: DevState;
  url: string | null;
  milestone: string | null;
  milestone_code: string | null;
  milestone_name: string | null;
  milestone_sort_key: number;
  labels: string[];
  priority: string | null;
  lane: string | null;
  size: string | null;
  status: string | null;
  is_stub: boolean;
  assignees: string[];
}

export interface Edge {
  src: string;
  dst: string;
  kind: string;
}

const CORPUS_VERSION_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function parseSinceQuery(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64 || !CORPUS_VERSION_RE.test(trimmed)) return null;
  return trimmed;
}

function visibleRepoSet(visible: string[]): Set<string> {
  return new Set(visible);
}

function keyInVisibleRepos(key: string, visible: Set<string>): boolean {
  const hash = key.lastIndexOf("#");
  if (hash <= 0) return false;
  return visible.has(key.slice(0, hash));
}

export const graphRoute = async (c: Context<AuthEnv>) => {
  const session = c.get("session");
  const sealedKeys = session
    ? await loadZkSealedIssueKeysForUser(c.env.DB, session.userId)
    : new Set<string>();

  const visible = await resolveVisibleRepos(c);

  if (visible.length === 0) {
    return c.json({ nodes: [], edges: [], repos: [], mode: "full", version: "" });
  }

  const searchParams = new URL(c.req.url).searchParams;
  const statusFilter = parseStatusQuery(searchParams.get("status"));
  const closedUnderOpenEpic = parseClosedUnderOpenEpicQuery(
    searchParams.get("closed_under_open_epic"),
  );
  const since = parseSinceQuery(searchParams.get("since"));

  const corpusVersion = await getCorpusVersion(c.env.DB);

  const etag = await computeEtag([
    corpusVersion,
    visible.slice().sort().join(","),
    await sealVersionForKeys(sealedKeys),
    searchParams.get("status") ?? "",
    searchParams.get("closed_under_open_epic") ?? "",
    since ?? "",
  ]);

  if (etagMatches(c.req.header("if-none-match"), etag)) {
    return c.body(null, 304, { ETag: etag });
  }

  const useDelta = since != null && since.length > 0 && since < corpusVersion;
  let tenantPlan: Awaited<ReturnType<typeof getTenantPlan>> | undefined;

  if (session?.tenantId) {
    tenantPlan = await getTenantPlan(c.env.DB, session.tenantId);
    const minHeadroom = useDelta ? MIN_DELTA_GRAPH_ROWS : undefined;
    if (!(await reserveGraphRowsBudget(c.env.DB, session.tenantId, tenantPlan, minHeadroom))) {
      return graphQuotaDeniedResponse(c);
    }
  }

  const tenantId = session?.tenantId ?? null;
  let rowsRead = 0;

  if (useDelta) {
    const { changes, rowsRead: changelogRows } = await collectGraphChangesSince(c.env.DB, since);
    rowsRead += changelogRows;
    const visibleSet = visibleRepoSet(visible);
    const removedSet = new Set<string>();
    const seedKeys = new Set<string>();

    for (const change of changes) {
      if (change.op === "delete") {
        if (keyInVisibleRepos(change.issue_key, visibleSet)) {
          removedSet.add(change.issue_key);
        }
        continue;
      }
      if (keyInVisibleRepos(change.issue_key, visibleSet)) {
        seedKeys.add(change.issue_key);
      }
    }
    const removed_keys = [...removedSet];

    if (seedKeys.size > MAX_DELTA_KEYS) {
      const full = await buildGraphPayload({
        db: c.env.DB,
        visible,
        sealedKeys,
        tenantId,
        statusFilter,
        closedUnderOpenEpic,
      });
      rowsRead += full.rowsRead;
      if (session?.tenantId && tenantPlan) {
        if (!(await recordGraphRowsSpend(c.env.DB, session.tenantId, rowsRead, tenantPlan))) {
          return graphQuotaDeniedResponse(c);
        }
      }
      return c.json(
        { ...full, mode: "full", version: corpusVersion },
        200,
        { ETag: etag, "Cache-Control": "private, no-cache" },
      );
    }

    if (seedKeys.size === 0 && removed_keys.length === 0) {
      if (session?.tenantId && tenantPlan) {
        await recordGraphRowsSpend(c.env.DB, session.tenantId, rowsRead, tenantPlan);
      }
      return c.json(
        { mode: "delta", nodes: [], edges: [], repos: [], removed_keys: [], version: corpusVersion },
        200,
        { ETag: etag, "Cache-Control": "private, no-cache" },
      );
    }

    const expanded = await expandGraphKeys(c.env.DB, [...seedKeys], visible);
    rowsRead += expanded.rowsRead;

    if (expanded.keys.length > MAX_DELTA_KEYS) {
      const full = await buildGraphPayload({
        db: c.env.DB,
        visible,
        sealedKeys,
        tenantId,
        statusFilter,
        closedUnderOpenEpic,
      });
      rowsRead += full.rowsRead;
      if (session?.tenantId && tenantPlan) {
        if (!(await recordGraphRowsSpend(c.env.DB, session.tenantId, rowsRead, tenantPlan))) {
          return graphQuotaDeniedResponse(c);
        }
      }
      return c.json(
        { ...full, mode: "full", version: corpusVersion },
        200,
        { ETag: etag, "Cache-Control": "private, no-cache" },
      );
    }

    const delta = await buildGraphPayload({
      db: c.env.DB,
      visible,
      sealedKeys,
      tenantId,
      keys: expanded.keys,
      statusFilter,
      closedUnderOpenEpic,
    });
    rowsRead += delta.rowsRead;

    if (session?.tenantId && tenantPlan) {
      if (!(await recordGraphRowsSpend(c.env.DB, session.tenantId, rowsRead, tenantPlan))) {
        return graphQuotaDeniedResponse(c);
      }
    }

    return c.json(
      {
        mode: "delta",
        nodes: delta.nodes,
        edges: delta.edges,
        repos: delta.repos,
        removed_keys,
        version: corpusVersion,
      },
      200,
      { ETag: etag, "Cache-Control": "private, no-cache" },
    );
  }

  const full = await buildGraphPayload({
    db: c.env.DB,
    visible,
    sealedKeys,
    tenantId,
    statusFilter,
    closedUnderOpenEpic,
  });
  rowsRead += full.rowsRead;

  if (session?.tenantId && tenantPlan) {
    if (!(await recordGraphRowsSpend(c.env.DB, session.tenantId, rowsRead, tenantPlan))) {
      return graphQuotaDeniedResponse(c);
    }
  }

  return c.json(
    { ...full, mode: "full", version: corpusVersion },
    200,
    { ETag: etag, "Cache-Control": "private, no-cache" },
  );
};