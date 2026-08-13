/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import {
  assertReadable,
  isPlatformOrganization,
  scopeOrganization,
} from "./shared";

// convex-test exige le map COMPLET des modules pour resoudre les fonctions
// enregistrees : un map partiel les rend silencieusement inatteignables.
const modules = import.meta.glob("./../**/*.ts");

// Holding an aiops capability is not a licence to read the whole platform.
// Capabilities live in per-organization role policies, so a single organization
// provisioned with the wrong kind would otherwise read every tenant's traces,
// audit log and replay payloads. These tests lock the tenant boundary.

const auth = (organizationId: string) => ({
  organizationId,
  memberId: "member-1",
  rolePolicyId: "policy-1",
  permissions: [],
});

const seedProfile = (
  t: ReturnType<typeof convexTest>,
  organizationId: string,
  kind: "adc" | "cooperative",
  status: "active" | "suspended" = "active",
) =>
  t.run((ctx) =>
    ctx.db.insert("organizationProfiles", { organizationId, kind, status }),
  );

describe("aiops tenant boundary", () => {
  it("recognises only an active platform organization", async () => {
    const t = convexTest(schema, modules);
    await seedProfile(t, "org-adc", "adc");
    await seedProfile(t, "org-coop", "cooperative");
    await seedProfile(t, "org-adc-suspended", "adc", "suspended");

    expect(await t.run((ctx) => isPlatformOrganization(ctx, "org-adc"))).toBe(true);
    expect(await t.run((ctx) => isPlatformOrganization(ctx, "org-coop"))).toBe(false);
    // A suspended platform organization loses its cross-tenant reach.
    expect(
      await t.run((ctx) => isPlatformOrganization(ctx, "org-adc-suspended")),
    ).toBe(false);
    // No profile at all is denied, not defaulted.
    expect(await t.run((ctx) => isPlatformOrganization(ctx, "ghost"))).toBe(false);
  });

  it("pins a tenant to its own organization whatever it asks for", async () => {
    const t = convexTest(schema, modules);
    await seedProfile(t, "org-adc", "adc");
    await seedProfile(t, "org-coop", "cooperative");

    // A cooperative asking for another organization is silently pinned to its own.
    expect(
      await t.run((ctx) => scopeOrganization(ctx, auth("org-coop"), "org-victim")),
    ).toBe("org-coop");
    // Asking for the platform-wide view (undefined) does not widen it either.
    expect(
      await t.run((ctx) => scopeOrganization(ctx, auth("org-coop"), undefined)),
    ).toBe("org-coop");
    // The platform operator keeps its cross-tenant reach. Note: crossing the
    // Convex boundary serialises undefined to null, hence toBeNull below.
    expect(
      await t.run((ctx) => scopeOrganization(ctx, auth("org-adc"), "org-coop")),
    ).toBe("org-coop");
    expect(
      await t.run((ctx) => scopeOrganization(ctx, auth("org-adc"), undefined)),
    ).toBeNull();
  });

  it("refuses a record owned by another organization", async () => {
    const t = convexTest(schema, modules);
    await seedProfile(t, "org-adc", "adc");
    await seedProfile(t, "org-coop", "cooperative");

    // Own record: allowed (resolving at all means no denial was thrown).
    await expect(
      t.run((ctx) => assertReadable(ctx, auth("org-coop"), "org-coop")),
    ).resolves.toBeNull();
    // Another tenant's record, reached by a guessed id: refused.
    await expect(
      t.run((ctx) => assertReadable(ctx, auth("org-coop"), "org-victim")),
    ).rejects.toThrow();
    // A record with no organization is not a free-for-all either.
    await expect(
      t.run((ctx) => assertReadable(ctx, auth("org-coop"), undefined)),
    ).rejects.toThrow();
    // The platform operator may read across tenants.
    await expect(
      t.run((ctx) => assertReadable(ctx, auth("org-adc"), "org-victim")),
    ).resolves.toBeNull();
  });
});
