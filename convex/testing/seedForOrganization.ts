import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { guardNotProduction, ensureEntitlement } from "./orgHelpers";
import { seedFarmer } from "./contentHelpers";
import { addCropLink } from "../farmers/model";
import { FARMER_ZONE_ID } from "./fixtures";
import {
  createAlertForOrg,
  addAudienceRule,
  createDeliveriesForOrg,
  resolveAudience,
  setDeliveryStateByAlertAndFarmer,
} from "../alerts/model";

// §64 — donnees de demonstration pour une organisation REELLE.
//
// Le seed principal travaille sur des identifiants synthetiques (demo-coop-a).
// Une organisation creee via Better Auth porte un identifiant genere : ses
// ecrans seraient donc vides. Cette mutation seme le meme jeu de demonstration
// sur l'identifiant reel, pour que la console montre des donnees des la
// premiere connexion.
//
// Idempotente et refusee en production.

const CROPS = ["cacao", "anacarde", "riz"];
const LANGUAGES = ["dyu", "fr", "bci"];

export const seedForOrganization = internalMutation({
  args: {
    organizationId: v.string(),
    farmerCount: v.optional(v.number()),
    maxFarmers: v.optional(v.number()),
    withAlert: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    guardNotProduction();
    const now = Date.now();
    const count = Math.min(args.farmerCount ?? 12, 50);

    // Droits du plan : permet d'afficher le quota et de tester sa limite.
    await ensureEntitlement(ctx, {
      organizationId: args.organizationId,
      key: "maxFarmers",
      enabled: true,
      limit: args.maxFarmers ?? 500,
    });
    await ensureEntitlement(ctx, {
      organizationId: args.organizationId,
      key: "whatsappEnabled",
      enabled: true,
    });

    // Agriculteurs repartis sur plusieurs cultures et langues, pour que les
    // filtres et le ciblage aient de la matiere.
    const farmerIds = [];
    for (let index = 0; index < count; index++) {
      // seedFarmer pose deja profil, zone, culture de reference et consentement.
      const { farmerId } = await seedFarmer(
        ctx,
        {
          organizationId: args.organizationId,
          externalIdentityHash: `${args.organizationId}-F${String(index + 1).padStart(3, "0")}`,
          preferredLanguage: LANGUAGES[index % LANGUAGES.length]!,
        },
        now,
      );
      // Culture supplementaire variable : donne de la matiere aux filtres et au
      // ciblage par culture.
      await addCropLink(
        ctx,
        args.organizationId,
        farmerId,
        CROPS[index % CROPS.length]!,
      );
      farmerIds.push(farmerId);
    }

    let alertId = null;
    let cibles = 0;
    if (args.withAlert !== false) {
      alertId = await createAlertForOrg(
        ctx,
        args.organizationId,
        "demo-seed",
        { message: "Forte pluie prevue demain sur Abidjan Nord." },
        now,
      );
      await addAudienceRule(ctx, args.organizationId, alertId, {
        kind: "zone",
        targetKey: FARMER_ZONE_ID,
      });
      const audience = await resolveAudience(ctx, args.organizationId, [
        { kind: "zone", targetKey: FARMER_ZONE_ID },
      ]);
      cibles = await createDeliveriesForOrg(
        ctx,
        args.organizationId,
        alertId,
        audience,
        now,
      );
      // Cycle de diffusion partiel : rend le funnel lisible a l'ecran.
      for (const [index, farmerId] of audience.entries()) {
        const etat =
          index % 4 === 0 ? "read" : index % 3 === 0 ? "delivered" : "sent";
        await setDeliveryStateByAlertAndFarmer(ctx, alertId, farmerId, etat);
      }
    }

    return {
      organizationId: args.organizationId,
      agriculteurs: farmerIds.length,
      alerte: alertId,
      cibles,
    };
  },
});
