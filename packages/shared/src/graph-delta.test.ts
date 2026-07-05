import { describe, expect, it } from "vitest";
import { mergeGraphDelta } from "./graph-delta";
import type { GraphResponse } from "./types";

const base: GraphResponse = {
  nodes: [
    {
      key: "Roxabi/roxabi-live#1",
      repo: "Roxabi/roxabi-live",
      number: 1,
      title: "One",
      state: "open",
      dev_state: "idle",
      url: null,
      milestone: null,
      milestone_code: null,
      milestone_name: null,
      milestone_sort_key: 0,
      labels: [],
      priority: null,
      lane: null,
      size: null,
      status: null,
      is_stub: false,
      assignees: [],
    },
    {
      key: "Roxabi/roxabi-live#2",
      repo: "Roxabi/roxabi-live",
      number: 2,
      title: "Two",
      state: "open",
      dev_state: "idle",
      url: null,
      milestone: null,
      milestone_code: null,
      milestone_name: null,
      milestone_sort_key: 0,
      labels: [],
      priority: null,
      lane: null,
      size: null,
      status: null,
      is_stub: false,
      assignees: [],
    },
  ],
  edges: [{ src: "Roxabi/roxabi-live#1", dst: "Roxabi/roxabi-live#2", kind: "blocks" }],
  repos: [
    {
      repo: "Roxabi/roxabi-live",
      archived: false,
      is_private: false,
      issue_count: 2,
      last_updated_at: null,
    },
  ],
  version: "2026-07-01T00:00:00.000Z",
};

describe("mergeGraphDelta", () => {
  it("updates touched nodes and edges without rescanning untouched nodes", () => {
    const delta: GraphResponse = {
      mode: "delta",
      version: "2026-07-02T00:00:00.000Z",
      removed_keys: [],
      nodes: [{ ...base.nodes[0], title: "One updated" }],
      edges: [],
      repos: [],
    };
    const merged = mergeGraphDelta(base, delta);
    expect(merged.nodes.find((n) => n.key.endsWith("#1"))?.title).toBe("One updated");
    expect(merged.nodes.find((n) => n.key.endsWith("#2"))?.title).toBe("Two");
    expect(merged.edges).toEqual(base.edges);
  });

  it("removes deleted keys and incident edges", () => {
    const delta: GraphResponse = {
      mode: "delta",
      version: "2026-07-02T00:00:00.000Z",
      removed_keys: ["Roxabi/roxabi-live#2"],
      nodes: [],
      edges: [],
      repos: [],
    };
    const merged = mergeGraphDelta(base, delta);
    expect(merged.nodes.map((n) => n.key)).toEqual(["Roxabi/roxabi-live#1"]);
    expect(merged.edges).toEqual([]);
  });
});