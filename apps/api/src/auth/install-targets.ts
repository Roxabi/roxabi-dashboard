/**
 * Cache of personal + org install targets for Settings / InstallGate.
 * Fetched from GitHub during OAuth; stored on users.install_targets_json.
 */

import type { InstallTarget } from "./github-install";
import { githubRestGet } from "./github-rest";

/**
 * Personal + orgs the user can install the App on.
 * `orgsFetched` is true only when GitHub returned a parseable org list — callers
 * must not overwrite a cached `install_targets_json` when it is false.
 */
export async function fetchInstallTargets(
  accessToken: string,
  ghUser: { id: number; login: string },
): Promise<{ targets: InstallTarget[]; orgsFetched: boolean }> {
  const orgsRes = await githubRestGet(
    "https://api.github.com/user/orgs?per_page=100",
    accessToken,
  );
  let orgs: Array<{ id: number; login: string }> = [];
  let orgsFetched = false;
  if (orgsRes.ok) {
    try {
      const body = (await orgsRes.json()) as unknown;
      if (Array.isArray(body)) {
        orgs = body as Array<{ id: number; login: string }>;
        orgsFetched = true;
      }
    } catch {
      orgsFetched = false;
    }
  }
  const targets: InstallTarget[] = [
    { id: ghUser.id, login: ghUser.login, type: "User" },
    ...orgs.map((o) => ({
      id: o.id,
      login: o.login,
      type: "Organization" as const,
    })),
  ];
  return { targets, orgsFetched };
}

/**
 * Upsert user row. When `replaceTargets` is false, keep existing
 * `install_targets_json` on conflict (GitHub /user/orgs flaked).
 */
export async function upsertUserWithInstallTargets(
  db: D1Database,
  ghUser: { id: number; login: string },
  targets: InstallTarget[],
  replaceTargets: boolean,
): Promise<{ id: number } | null> {
  return db
    .prepare(
      `INSERT INTO users (github_id, github_login, zk_opt_in, install_targets_json)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         github_login=excluded.github_login,
         zk_opt_in=1,
         install_targets_json = CASE
           WHEN ? THEN excluded.install_targets_json
           ELSE users.install_targets_json
         END,
         updated_at=datetime('now')
       RETURNING id`,
    )
    .bind(ghUser.id, ghUser.login, JSON.stringify(targets), replaceTargets ? 1 : 0)
    .first<{ id: number }>();
}
