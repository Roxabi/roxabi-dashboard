#!/usr/bin/env node
/**
 * Apply zone WAF rate-limit rules from infra/waf-rate-limit.json (#295).
 *
 * Requires:
 *   CLOUDFLARE_API_TOKEN — Zone.WAF Edit + Zone.Zone Read
 *   CLOUDFLARE_ZONE_ID   — roxabi.dev zone
 *
 * Usage:
 *   bun run setup:waf-rules
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = JSON.parse(readFileSync(join(ROOT, "infra/waf-rate-limit.json"), "utf8"));

const token = process.env.CLOUDFLARE_API_TOKEN;
const zoneId = process.env.CLOUDFLARE_ZONE_ID;

if (!token || !zoneId) {
  console.error("Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

async function api(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!body.success) {
    throw new Error(`${path} failed: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result;
}

async function main() {
  const entrypoint = await api("/rulesets/phases/http_ratelimit/entrypoint");
  const rules = SPEC.rules.map((rule, index) => ({
    ...rule,
    enabled: true,
    ref: `health_rate_limit_${index}`,
  }));

  await api(`/rulesets/${entrypoint.id}`, {
    method: "PUT",
    body: JSON.stringify({
      description: SPEC.description,
      rules,
    }),
  });

  console.log(`WAF http_ratelimit rules applied (${rules.length} rule(s))`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});