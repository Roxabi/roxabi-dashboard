import { describe, expect, it } from "vitest";
import { quotaLimitForMetric, runtimeConfig } from "./runtime-config";

describe("runtime-config", () => {
  it("loads quota limits from runtime.json", () => {
    expect(quotaLimitForMetric("free", "graph_rows")).toBe(125_000);
    expect(quotaLimitForMetric("paid", "graph_rows")).toBe(2_500_000);
  });

  it("exposes graph and client tunables", () => {
    expect(runtimeConfig.graph.maxDeltaKeys).toBe(400);
    expect(runtimeConfig.client.pollIntervalMs.version).toBe(15_000);
    expect(runtimeConfig.sync.maxPages).toBe(500);
  });
});