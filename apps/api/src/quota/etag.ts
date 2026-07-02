/**
 * ETag helpers for conditional GET on graph/version routes (#295 S2).
 */

/** Stable weak-ish ETag from arbitrary string components. */
export async function computeEtag(parts: string[]): Promise<string> {
  const payload = parts.join("\0");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}

export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((token) => token.trim() === etag);
}

export async function getGlobalDataVersion(db: D1Database): Promise<string> {
  const row = await db
    .prepare(
      `SELECT COALESCE(value, '') AS v FROM sync_control WHERE key = 'data_version' AND tenant_id = 0`,
    )
    .first<{ v: string }>();
  return row?.v ?? "";
}

export async function sealVersionForKeys(sealedKeys: Set<string>): Promise<string> {
  if (sealedKeys.size === 0) return "0";
  const sorted = [...sealedKeys].sort();
  return computeEtag(sorted);
}
