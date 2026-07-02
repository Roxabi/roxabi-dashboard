#!/usr/bin/env node
/**
 * Apply zone WAF rate-limit rules from infra/waf-rate-limit.json (#295).
 *
 * Auth (same as setup-live-domains):
 *   source scripts/bw-cloudflare-global-env.sh
 *   # or: source scripts/bw-cloudflare-live-build-env.sh && export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_BUILDS_ADMIN_TOKEN"
 *
 * Usage:
 *   bun run setup:waf-rules
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertCfCredentials, cf } from "./lib/cf-access.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = JSON.parse(readFileSync(join(ROOT, "infra/waf-rate-limit.json"), "utf8"));
const ZONE_NAME = process.env.CLOUDFLARE_ZONE_NAME ?? "roxabi.dev";

async function resolveZoneId() {
  if (process.env.CLOUDFLARE_ZONE_ID) return process.env.CLOUDFLARE_ZONE_ID;
  const zones = await cf(`/zones?name=${ZONE_NAME}`);
  const zone = zones?.[0];
  if (!zone?.id) throw new Error(`Zone not found: ${ZONE_NAME}`);
  return zone.id;
}

async function main() {
  assertCfCredentials();
  const zoneId = await resolveZoneId();
  const entrypoint = await cf(`/zones/${zoneId}/rulesets/phases/http_ratelimit/entrypoint`);
  const rules = SPEC.rules.map((rule, index) => ({
    ...rule,
    enabled: true,
    ref: `health_rate_limit_${index}`,
  }));

  await cf(`/zones/${zoneId}/rulesets/${entrypoint.id}`, {
    method: "PUT",
    body: JSON.stringify({
      description: SPEC.description,
      rules,
    }),
  });

  console.log(`WAF http_ratelimit rules applied on ${ZONE_NAME} (${rules.length} rule(s))`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});