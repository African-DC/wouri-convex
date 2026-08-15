/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { getFarmerByExternalHash } from "../farmers/model";
import { upsertFarmerByContact } from "./farmers";

const modules = import.meta.glob("./../**/*.ts");

/* Le serveur WhatsApp enregistre un agriculteur par sa référence de contact.
   Idempotent, sans numéro. */

describe("enregistrement d'agriculteur par contactRef", () => {
  it("crée l'agriculteur au premier contact", async () => {
    const t = convexTest(schema, modules);
    const res = await t.run((ctx) => upsertFarmerByContact(ctx, "org-a", "ref-xyz", 1000));
    expect(res.created).toBe(true);
    const farmer = await t.run((ctx) => getFarmerByExternalHash(ctx, "org-a", "ref-xyz"));
    expect(farmer?.externalIdentityHash).toBe("ref-xyz");
  });

  it("est idempotent : un rejeu retrouve le même agriculteur", async () => {
    const t = convexTest(schema, modules);
    const premier = await t.run((ctx) => upsertFarmerByContact(ctx, "org-a", "ref-xyz", 1000));
    const rejeu = await t.run((ctx) => upsertFarmerByContact(ctx, "org-a", "ref-xyz", 2000));
    expect(rejeu).toEqual({ farmerId: premier.farmerId, created: false });
    const total = await t.run(async (ctx) =>
      (await ctx.db.query("farmers").collect()).length,
    );
    expect(total).toBe(1);
  });

  it("isole par organisation : même référence, deux orgs, deux agriculteurs", async () => {
    const t = convexTest(schema, modules);
    const a = await t.run((ctx) => upsertFarmerByContact(ctx, "org-a", "ref-xyz", 1000));
    const b = await t.run((ctx) => upsertFarmerByContact(ctx, "org-b", "ref-xyz", 1000));
    expect(a.farmerId).not.toBe(b.farmerId);
  });
});
