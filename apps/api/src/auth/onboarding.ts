/**
 * Server-owned onboarding step derivation for /api/me and auth flows.
 */

import { type InstallTarget, githubInstallUrl, parseInstallTargets } from "./github-install";
import type { SessionContext } from "./types";

export type OnboardingStep = "install" | "consent" | "ready";

export interface InstallOption {
  kind: "personal" | "org" | "picker";
  login?: string;
  url: string;
}

export interface BuildInstallOptionsOpts {
  /** Logins already linked (case-insensitive) — excluded from "add install" options. */
  installedLogins?: Iterable<string>;
  /** Ensure a personal option exists even when install_targets_json is empty/stale. */
  personalFallback?: InstallTarget;
}

function normLogin(login: string): string {
  return login.toLowerCase();
}

/**
 * Build deep-links for installing the App on accounts the user can access.
 * Always ends with a picker so orgs outside our cached target list remain reachable
 * (Settings "add another org" and InstallGate both need this).
 */
export function buildInstallOptions(
  targets: InstallTarget[],
  appSlug?: string,
  opts: BuildInstallOptionsOpts = {},
): InstallOption[] {
  const installed = new Set(
    [...(opts.installedLogins ?? [])].map((l) => normLogin(l)).filter(Boolean),
  );

  const byKey = new Map<string, InstallTarget>();
  for (const t of targets) {
    byKey.set(`${t.type}:${normLogin(t.login)}`, t);
  }
  if (opts.personalFallback) {
    const key = `User:${normLogin(opts.personalFallback.login)}`;
    if (!byKey.has(key)) byKey.set(key, opts.personalFallback);
  }

  const merged = [...byKey.values()];
  const personal = merged.find((t) => t.type === "User");
  const orgs = merged.filter((t) => t.type === "Organization");

  const options: InstallOption[] = [];
  if (personal && !installed.has(normLogin(personal.login))) {
    options.push({
      kind: "personal",
      login: personal.login,
      url: githubInstallUrl(personal, appSlug),
    });
  }
  for (const org of orgs) {
    if (installed.has(normLogin(org.login))) continue;
    options.push({
      kind: "org",
      login: org.login,
      url: githubInstallUrl(org, appSlug),
    });
  }
  // Always offer the GitHub account/org picker for installs we don't know about yet.
  options.push({ kind: "picker", url: githubInstallUrl(undefined, appSlug) });
  return options;
}

export function deriveOnboardingStep(
  session: SessionContext,
  installations: Array<{ tenant_id: number }>,
  consentAt: string | null,
): OnboardingStep {
  const installPending = session.tenantId == null || installations.length === 0;
  if (installPending) return "install";
  if (!consentAt) return "consent";
  return "ready";
}

/** Always surface cached install targets — Settings needs them after onboarding too. */
export function installTargetsFromUserRow(
  _installPending: boolean,
  raw: string | null | undefined,
): InstallTarget[] {
  return parseInstallTargets(raw);
}
