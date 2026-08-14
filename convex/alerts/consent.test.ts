/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { createFarmerForOrg, addZoneLink, addConsent } from "../farmers/model";
import { resolveAudience, resolveTargeted } from "../alerts/model";
import { ALERT_CONSENT_PURPOSE } from "../alerts/audience";

const modules = import.meta.glob("./../**/*.ts");

// ALT-05 / G14 — opt-out must block any further delivery. The check belongs to
// audience resolution, which previewAudience and publishAlert both go through:
// filtering only one of them would let the preview promise a number the
// publication does not honour, or worse, let the publication reach a farmer the
// preview never showed.
describe("consentement et audience d'alerte", () => {
  const RULES = [{ kind: "zone" as const, targetKey: "korhogo" }];

  const preparer = async (
    ctx: Parameters<Parameters<ReturnType<typeof convexTest>["run"]>[0]>[0],
    etat: "granted" | "withdrawn" | "aucun",
  ) => {
    const now = 1000;
    const farmerId = await createFarmerForOrg(ctx, "org-a", "a1", now);
    await addZoneLink(ctx, "org-a", farmerId, "korhogo");
    if (etat !== "aucun") {
      await addConsent(ctx, farmerId, ALERT_CONSENT_PURPOSE, "v1", etat, "test", now);
    }
    return farmerId;
  };

  it("inclut un agriculteur qui a donné son consentement", async () => {
    const t = convexTest(schema, modules);
    const audience = await t.run(async (ctx) => {
      await preparer(ctx, "granted");
      return resolveAudience(ctx, "org-a", RULES);
    });
    expect(audience).toHaveLength(1);
  });

  it("exclut un agriculteur qui a retiré son consentement", async () => {
    const t = convexTest(schema, modules);
    const resultat = await t.run(async (ctx) => {
      const farmerId = await preparer(ctx, "granted");
      // Retrait postérieur : c'est l'état le plus récent qui fait foi.
      await addConsent(ctx, farmerId, ALERT_CONSENT_PURPOSE, "v1", "withdrawn", "test", 2000);
      return {
        cibles: (await resolveTargeted(ctx, "org-a", RULES)).length,
        joignables: (await resolveAudience(ctx, "org-a", RULES)).length,
      };
    });
    // Le ciblage le trouve toujours ; la diffusion ne l'atteint plus. L'écart
    // est ce que l'aperçu doit montrer plutôt que masquer.
    expect(resultat.cibles).toBe(1);
    expect(resultat.joignables).toBe(0);
  });

  it("exclut un agriculteur sans aucun consentement enregistré", async () => {
    const t = convexTest(schema, modules);
    const audience = await t.run(async (ctx) => {
      await preparer(ctx, "aucun");
      return resolveAudience(ctx, "org-a", RULES);
    });
    // Le silence n'est pas un consentement : l'absence de trace vaut refus.
    expect(audience).toHaveLength(0);
  });

  it("reprend l'agriculteur après un nouveau consentement", async () => {
    const t = convexTest(schema, modules);
    const audience = await t.run(async (ctx) => {
      const farmerId = await preparer(ctx, "withdrawn");
      await addConsent(ctx, farmerId, ALERT_CONSENT_PURPOSE, "v1", "granted", "test", 3000);
      return resolveAudience(ctx, "org-a", RULES);
    });
    expect(audience).toHaveLength(1);
  });
});
