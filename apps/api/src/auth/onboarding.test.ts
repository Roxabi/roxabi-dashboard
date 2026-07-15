import { describe, expect, it } from "vitest";
import { buildInstallOptions, deriveOnboardingStep } from "./onboarding";

const SESSION = {
  userId: 1,
  tenantId: 9,
  githubId: 42,
  githubLogin: "alice",
};

describe("deriveOnboardingStep", () => {
  it("returns install when no linked installations", () => {
    expect(deriveOnboardingStep({ ...SESSION, tenantId: null }, [], null)).toBe("install");
  });

  it("returns consent when linked but no consent_at", () => {
    expect(deriveOnboardingStep(SESSION, [{ tenant_id: 9 }], null)).toBe("consent");
  });

  it("returns ready when linked and consented", () => {
    expect(deriveOnboardingStep(SESSION, [{ tenant_id: 9 }], "2026-01-01")).toBe("ready");
  });
});

describe("buildInstallOptions", () => {
  it("builds personal, org, and always appends picker", () => {
    const opts = buildInstallOptions([
      { id: 1, login: "alice", type: "User" },
      { id: 2, login: "Roxabi", type: "Organization" },
    ]);
    expect(opts.map((o) => o.kind)).toEqual(["personal", "org", "picker"]);
  });

  it("skips already-installed logins and still offers picker", () => {
    const opts = buildInstallOptions(
      [
        { id: 1, login: "alice", type: "User" },
        { id: 2, login: "Roxabi", type: "Organization" },
      ],
      undefined,
      { installedLogins: ["Roxabi"] },
    );
    expect(opts.map((o) => o.kind)).toEqual(["personal", "picker"]);
    expect(opts.find((o) => o.kind === "personal")?.login).toBe("alice");
  });

  it("uses personalFallback when targets are empty", () => {
    const opts = buildInstallOptions([], undefined, {
      personalFallback: { id: 42, login: "alice", type: "User" },
    });
    expect(opts.map((o) => o.kind)).toEqual(["personal", "picker"]);
    expect(opts[0]?.login).toBe("alice");
  });

  it("filters installed logins case-insensitively", () => {
    const opts = buildInstallOptions(
      [
        { id: 1, login: "alice", type: "User" },
        { id: 2, login: "Roxabi", type: "Organization" },
      ],
      undefined,
      { installedLogins: ["roxabi"] },
    );
    expect(opts.map((o) => o.kind)).toEqual(["personal", "picker"]);
  });

  it("drops personalFallback when personal is already installed → picker only", () => {
    const opts = buildInstallOptions([{ id: 1, login: "alice", type: "User" }], undefined, {
      installedLogins: ["alice"],
      personalFallback: { id: 1, login: "alice", type: "User" },
    });
    expect(opts.map((o) => o.kind)).toEqual(["picker"]);
  });
});
