/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { ALERT_CONSENT_PURPOSE } from "../alerts/audience";
import {
  addConsent,
  addCropLink,
  addZoneLink,
  createFarmerForOrg,
  listFarmerRosterForOrg,
  upsertFarmerProfile,
} from "./model";

const modules = import.meta.glob("./../**/*.ts");

describe("roster agriculteurs", () => {
  it("expose le profil, la zone et le consentement, pas le hash", async () => {
    const t = convexTest(schema, modules);
    const page = await t.run(async (ctx) => {
      const farmerId = await createFarmerForOrg(ctx, "org-a", "secret-hash-ne-pas-afficher", 1000);
      await upsertFarmerProfile(
        ctx,
        farmerId,
        { preferredLanguage: "dyu", countryCode: "CI", notificationOptIn: true },
        1000,
      );
      await addZoneLink(ctx, "org-a", farmerId, "Bouake");
      await addCropLink(ctx, "org-a", farmerId, "mais");
      await addConsent(ctx, farmerId, ALERT_CONSENT_PURPOSE, "v1", "granted", "test", 1000);
      return listFarmerRosterForOrg(ctx, "org-a", { numItems: 10, cursor: null });
    });

    expect(page.page).toHaveLength(1);
    const row = page.page[0];
    expect(row).not.toHaveProperty("externalIdentityHash");
    expect(row.preferredLanguage).toBe("dyu");
    expect(row.zoneIds).toEqual(["Bouake"]);
    expect(row.cropCodes).toEqual(["mais"]);
    expect(row.consent.state).toBe("granted");
  });

  it("marque hors diffusion un agriculteur sans consentement", async () => {
    const t = convexTest(schema, modules);
    const page = await t.run(async (ctx) => {
      await createFarmerForOrg(ctx, "org-a", "ref-sans-accord", 1000);
      return listFarmerRosterForOrg(ctx, "org-a", { numItems: 10, cursor: null });
    });
    expect(page.page[0]?.consent.state).toBe("never");
  });
});
