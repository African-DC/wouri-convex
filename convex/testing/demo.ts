import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getFarmerByExternalHash } from "../farmers/model";
import {
  createAlertForOrg,
  addAudienceRule,
  createDeliveriesForOrg,
  resolveAudience,
  setDeliveryStateByAlertAndFarmer,
  getAlertForOrg,
} from "../alerts/model";
import { recordInboundReply, resolveAlertContext } from "../conversations/model";
import { sourceVersionVisibleToOrg } from "../knowledge/model";
import { FARMERS, FARMER_ZONE_ID } from "./fixtures";

// QA-07 — scénario de démonstration REPRODUCTIBLE pour la restitution.
//
// Critère d'acceptation de la feuille de route : « démo répétable sans
// manipulation manuelle fragile ». Cette mutation rejoue le parcours complet et
// renvoie, porte par porte, la preuve de ce qui est démontré. Une seule commande,
// aucun clic, aucun ordre d'opérations à retenir.
//
// Prérequis : le seed de démonstration doit avoir été exécuté (testing/seed).
// À exécuter sur STAGING uniquement : le garde-fou ci-dessous refuse la production.

const runtimeEnvironment = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

const guardNotProduction = () => {
  const env = runtimeEnvironment.process?.env ?? {};
  if (env.WOURI_ENV === "production") {
    throw new Error(
      "Scenario de demonstration refuse en production : il ecrit des donnees.",
    );
  }
};

const DEMO_ORG = "demo-coop-a";
const OTHER_ORG = "demo-coop-b";
const ALERT_MESSAGE = "Forte pluie prevue demain sur Abidjan Nord.";
const FARMER_REPLY = "Et pour mon cacao ?";

type Evidence = { gate: string; claim: string; proof: unknown; ok: boolean };

const requireDemoFarmer = async (ctx: MutationCtx, organizationId: string) => {
  const fixture = FARMERS.find((f) => f.organizationId === organizationId);
  if (!fixture) throw new Error(`Aucune fixture d'agriculteur pour ${organizationId}`);
  const farmer = await getFarmerByExternalHash(
    ctx,
    organizationId,
    fixture.externalIdentityHash,
  );
  if (!farmer) {
    throw new Error(
      `Agriculteur de demonstration absent pour ${organizationId}. ` +
        "Executer d'abord testing/seed:seedStaging.",
    );
  }
  return farmer;
};

export const runScenario = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    guardNotProduction();
    const evidence: Evidence[] = [];
    const now = Date.now();

    const farmerA = await requireDemoFarmer(ctx, DEMO_ORG);
    const farmerB = await requireDemoFarmer(ctx, OTHER_ORG);

    if (args.dryRun) {
      return {
        mode: "dryRun",
        message: "Prerequis verifies, aucune ecriture effectuee.",
        organisation: DEMO_ORG,
        agriculteur: farmerA._id,
      };
    }

    // --- G06 : la source SODEXAM est traçable ------------------------------
    const observation = await ctx.db
      .query("weatherObservations")
      .withIndex("by_zoneId_and_validFrom", (q) => q.eq("zoneId", FARMER_ZONE_ID))
      .order("desc")
      .first();
    const provenance = observation
      ? await sourceVersionVisibleToOrg(ctx, observation.sourceVersionId, DEMO_ORG)
      : null;
    evidence.push({
      gate: "G06",
      claim: "La donnee meteo porte sa source, sa version et son origine.",
      proof: {
        autorite: provenance?.source.authority ?? null,
        version: provenance?.version.version ?? null,
        origine: observation?.dataOrigin ?? null,
        zone: FARMER_ZONE_ID,
      },
      ok: provenance?.source.authority === "SODEXAM",
    });

    // --- G03 : le ciblage reste dans l'organisation -------------------------
    const alertId = await createAlertForOrg(
      ctx,
      DEMO_ORG,
      "demo-coop-a-admin",
      {
        message: ALERT_MESSAGE,
        ...(observation ? { sourceVersionId: observation.sourceVersionId } : {}),
      },
      now,
    );
    await addAudienceRule(ctx, DEMO_ORG, alertId, {
      kind: "zone",
      targetKey: FARMER_ZONE_ID,
    });
    const audience = await resolveAudience(ctx, DEMO_ORG, [
      { kind: "zone", targetKey: FARMER_ZONE_ID },
    ]);
    evidence.push({
      gate: "G03",
      claim:
        "L'audience d'une organisation ne contient jamais l'agriculteur d'une autre.",
      proof: {
        cibles: audience.length,
        contientAgriculteurDeLAutreOrg: audience.includes(farmerB._id),
      },
      ok: audience.includes(farmerA._id) && !audience.includes(farmerB._id),
    });

    // --- G05 : diffusion puis reponse qui ouvre une conversation ------------
    await createDeliveriesForOrg(ctx, DEMO_ORG, alertId, audience, now);
    for (const etat of ["sent", "delivered", "read"] as const) {
      await setDeliveryStateByAlertAndFarmer(ctx, alertId, farmerA._id, etat);
    }
    const { contextId } = await recordInboundReply(
      ctx,
      {
        organizationId: DEMO_ORG,
        farmerId: farmerA._id,
        channel: "whatsapp",
        preferredLanguage: "dyu",
        alertId,
        text: FARMER_REPLY,
      },
      now,
    );
    const recovered = await resolveAlertContext(ctx, DEMO_ORG, contextId);
    evidence.push({
      gate: "G05",
      claim:
        "La reponse de l'agriculteur retrouve l'alerte d'origine sans qu'il la repete.",
      proof: {
        messageAgriculteur: FARMER_REPLY,
        alerteRetrouvee: recovered?.alert.message ?? null,
        zonesDeLAlerte: recovered?.zones ?? [],
        sourceDeLAlerte: recovered?.provenance?.source?.authority ?? null,
      },
      ok: recovered?.alert.message === ALERT_MESSAGE,
    });

    // --- G03 (suite) : une autre organisation ne voit rien ------------------
    const fuite = await resolveAlertContext(ctx, OTHER_ORG, contextId);
    evidence.push({
      gate: "G03",
      claim: "Une autre organisation ne peut pas lire cette conversation.",
      proof: { lectureParAutreOrg: fuite },
      ok: fuite === null,
    });

    // --- G14 : le cycle de diffusion est persiste ---------------------------
    const detail = await getAlertForOrg(ctx, DEMO_ORG, alertId);
    evidence.push({
      gate: "G14",
      claim: "Le cycle de diffusion est trace et auditable.",
      proof: { etats: detail?.deliverySummary.byState ?? null },
      ok: (detail?.deliverySummary.byState.replied ?? 0) >= 1,
    });

    const echecs = evidence.filter((e) => !e.ok).map((e) => e.gate);
    return {
      mode: "execute",
      organisation: DEMO_ORG,
      alerte: alertId as Id<"alerts">,
      conversation: contextId,
      portesDemontrees: evidence.filter((e) => e.ok).length,
      portesEnEchec: echecs,
      preuves: evidence,
    };
  },
});
