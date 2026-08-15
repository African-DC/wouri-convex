import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import * as model from "../farmers/model";
import { recordAudit } from "../lib/audit";

// Point 1 d'Issouf, volet « qui peuple les contactRef ».
//
// Le serveur WhatsApp est le seul à détenir les numéros : c'est donc lui qui
// calcule la contactRef (HMAC du numéro) et enregistre l'agriculteur dans Convex.
// registerFarmer exige une session Console : le serveur n'en a pas. Ce upsert
// signé est le pont. Convex ne reçoit qu'une empreinte opaque, jamais un numéro.
//
// Idempotent : rejoué avec la même contactRef, il renvoie l'agriculteur existant
// sans le dupliquer (le premier message d'un agriculteur peut être rejoué).

export type UpsertFarmerResult = { farmerId: string; created: boolean };

export const upsertFarmerByContact = async (
  ctx: MutationCtx,
  organizationId: string,
  contactRef: string,
  now: number,
): Promise<UpsertFarmerResult> => {
  const existing = await model.getFarmerByExternalHash(ctx, organizationId, contactRef);
  if (existing) return { farmerId: existing._id, created: false };

  const farmerId = await model.createFarmerForOrg(ctx, organizationId, contactRef, now);
  await recordAudit(
    ctx,
    {
      organizationId,
      actorSubject: "system:whatsapp",
      action: "farmer.register",
      resourceType: "farmers",
      resourceId: farmerId,
      after: { source: "whatsapp_first_contact" },
    },
    now,
  );
  return { farmerId, created: true };
};

/**
 * Le serveur WhatsApp enregistre (ou retrouve) un agriculteur par sa référence de
 * contact. Aucune donnée personnelle : ni numéro, ni nom.
 */
export const registerFarmerByContact = internalMutation({
  args: { organizationId: v.string(), contactRef: v.string() },
  handler: async (ctx, args) =>
    upsertFarmerByContact(ctx, args.organizationId, args.contactRef, Date.now()),
});
