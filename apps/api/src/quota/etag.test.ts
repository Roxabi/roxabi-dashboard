import { describe, expect, it } from "vitest";
import { computeEtag, etagMatches, sealVersionForKeys } from "./etag";

describe("etag helpers", () => {
  it("computeEtag is stable for same inputs", async () => {
    const a = await computeEtag(["v1", "repo/a", "0"]);
    const b = await computeEtag(["v1", "repo/a", "0"]);
    expect(a).toBe(b);
  });

  it("etagMatches handles comma-separated tokens", () => {
    const etag = '"abc"';
    expect(etagMatches('"abc"', etag)).toBe(true);
    expect(etagMatches('"old", "abc"', etag)).toBe(true);
    expect(etagMatches('"nope"', etag)).toBe(false);
  });

  it("sealVersionForKeys encodes sealed set", () => {
    expect(sealVersionForKeys(new Set())).toBe("0");
    expect(sealVersionForKeys(new Set(["a", "b"]))).toContain("2:");
  });
});
