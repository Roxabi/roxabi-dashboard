import type { Context } from "hono";
import { getCorpusVersion } from "../graph/corpus-version";
import { etagMatches } from "../quota";
import type { Env } from "../types";

/**
 * GET /api/version — cheap change-detection token for the frontend poller
 * (frontend/app.js polls every 15s and reloads the graph when `version` changes).
 *
 * Response shape MUST stay `{ version: string }` — matches the Python
 * `app.py::api_version` contract consumed by `frontend/app.js::fetchVersion`.
 *
 * Returns MAX across:
 *   - sync_state.last_synced_at  (advances on hourly cron)
 *   - sync_control['data_version'] (bumped on every mutating webhook dispatch)
 *
 * Both columns are ISO-8601 strings and compare lexicographically, so MAX()
 * over the UNION ALL correctly returns the most-recent write regardless of
 * which path produced it. Resolves #133.
 */
export const versionRoute = async (c: Context<{ Bindings: Env }>) => {
  const version = await getCorpusVersion(c.env.DB);
  const etag = `"${version}"`;
  if (etagMatches(c.req.header("if-none-match"), etag)) {
    return c.body(null, 304, { ETag: etag, "Cache-Control": "max-age=10" });
  }
  return c.json({ version }, 200, { ETag: etag, "Cache-Control": "max-age=10" });
};
