import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import * as model from "../farmers/model";
import { ALERT_CONSENT_PURPOSE, ALERT_CONSENT_POLICY_VERSION } from "../alerts/audience";
import { recordAudit } from "../lib/audit";

// Chantier 3 — opt-out. Quand un agriculteur répond STOP sur WhatsApp, le serveur
// signale l'événement ici et on retire son consentement à la diffusion d'alertes.
//
// C'est un droit de l'agriculteur : il aboutit toujours, sans passer par une
// permission d'agent (l'appelant est le serveur WhatsApp signé, pas un membre de
// la Console). Le retrait est tracé avec un acteur système pour rester imputable.
// resolveAudience filtre déjà sur ce même motif, donc le prochain envoi l'exclut.

const ACTEUR_SYSTEME = "system:whatsapp";

export type OptOutResult =
  | { applied: true; farmerId: string }
  | { applied: false; reason: "unknown_contact" | "already_withdrawn" };

// Cœur isolé de la couche Convex, testable directement.
export const applyOptOut = async (
  ctx: MutationCtx,
  organizationId: string,
  contactRef: string,
  now: number,
): Promise<OptOutResult> => {
  const farmer = await model.getFarmerByExternalHash(ctx, organizationId, contactRef);
  if (!farmer) return { applied: false, reason: "unknown_contact" };

  const latest = await model.latestConsent(ctx, farmer._id, ALERT_CONSENT_PURPOSE);
  // Idempotent : un STOP déjà pris en compte ne réécrit rien.
  if (latest?.state === "withdrawn") {
    return { applied: false, reason: "already_withdrawn" };
  }

  // On conserve la version sous laquelle l'accord existait ; à défaut, la version
  // en vigueur du motif.
  const policyVersion = latest?.policyVersion ?? ALERT_CONSENT_POLICY_VERSION;
  const consentId = await model.addConsent(
    ctx,
    farmer._id,
    ALERT_CONSENT_PURPOSE,
    policyVersion,
    "withdrawn",
    "whatsapp_stop",
    now,
  );

  await recordAudit(
    ctx,
    {
      organizationId,
      actorSubject: ACTEUR_SYSTEME,
      action: "farmer.consent.withdraw",
      resourceType: "farmerConsents",
      resourceId: consentId,
      before: latest ? { state: latest.state } : undefined,
      after: { purpose: ALERT_CONSENT_PURPOSE, state: "withdrawn", source: "whatsapp_stop" },
    },
    now,
  );

  return { applied: true, farmerId: farmer._id };
};

/**
 * Le serveur WhatsApp signale un STOP entrant. On retire le consentement à la
 * diffusion pour ce contact, sans jamais manipuler de numéro : le serveur envoie
 * la référence de contact (l'empreinte d'identité), Convex ne voit rien d'autre.
 */
export const recordOptOut = internalMutation({
  args: { organizationId: v.string(), contactRef: v.string() },
  handler: async (ctx, args) =>
    applyOptOut(ctx, args.organizationId, args.contactRef, Date.now()),
});
