/**
 * GET /api/quota — tenant-facing daily usage for SPA banner (#295).
 */

import type { Context } from "hono";
import type { AuthEnv } from "../auth/types";
import { getTenantQuotaStatus } from "../quota";

export async function tenantQuotaRoute(c: Context<AuthEnv>): Promise<Response> {
  const session = c.get("session");
  if (!session?.tenantId) {
    return c.json({ error: "no linked tenant" }, 403);
  }
  const status = await getTenantQuotaStatus(c.env.DB, session.tenantId);
  return c.json(status);
}
