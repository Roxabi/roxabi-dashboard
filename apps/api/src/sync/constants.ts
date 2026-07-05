/**
 * Pagination + windowing constants for the corpus sync engine.
 * Values: packages/shared/config/runtime.json → sync
 */

import { runtimeConfig } from "@roxabi-live/shared";

const { sync } = runtimeConfig;

export const MAX_PAGES = sync.maxPages;
/**
 * Repos synced per cron tick. Capped at 20 to stay under the Workers Free
 * 50-subrequest/invocation budget: a FULL reconcile (#80, since=null) costs
 * ~1 subrequest per issue page, and the largest repo (roxabi-factory, ~1k
 * issues) alone is ~11 pages — so a single run cannot reconcile all repos.
 */
export const WINDOW = sync.window;
/** Bootstrap: one full-reconcile repo per waitUntil (stays under 50-subreq cap). */
export const BOOTSTRAP_WINDOW = sync.bootstrapWindow;
/**
 * Rotation slots. Coverage ceiling = WINDOW * NUM_SLOTS = 40 repos; with the
 * daily cron each repo is full-reconciled every NUM_SLOTS days (= 2). 36 repos
 * today → fits in 2 slots, no wasted tick. Beyond 40 repos, raise this / WINDOW
 * (watch the subreq budget) or migrate to the dormant Queues fan-out (wrangler.toml).
 */
export const NUM_SLOTS = sync.numSlots;
/** Cap GraphQL repo probes per discovery pass (#295 — kills quadratic bootstrap). */
export const MAX_DISCOVERY_PROBES_PER_PASS = sync.maxDiscoveryProbesPerPass;