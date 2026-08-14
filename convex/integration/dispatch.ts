import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Chantier 2 — diffusion des alertes, en mode PULL.
//
// Convex Cloud ne peut pas atteindre le serveur WhatsApp : il est sur un réseau
// privé, sans route publique (vérifié : aucun label Traefik). Un push
// Convex -> serveur est donc impossible. On inverse, comme pour le corpus : le
// serveur, qui atteint déjà Convex, récupère les livraisons à envoyer et
// rapporte l'identifiant du message une fois parti.
//
// Contrepartie de vie privée : Convex ne connaît jamais le numéro. La livraison
// porte une RÉFÉRENCE DE CONTACT (l'identité externe de l'agriculteur), que le
// serveur, seul détenteur des numéros, résout de son côté.

const LOT_MAX = 200;

// Cœur isolé de la couche Convex : convex-test ne résout pas une internalQuery
// par référence depuis ce dossier, séparer le calcul évite d'en dépendre.
export const selectPending = async (ctx: QueryCtx, limite: number) => {
  const borne = Math.min(limite, LOT_MAX);
  const livraisons = await ctx.db
    .query("alertDeliveries")
    .withIndex("by_state_and_createdAt", (q) => q.eq("state", "created"))
    .order("asc")
    .take(borne);

  const sorties = [];
  for (const livraison of livraisons) {
    const alerte = await ctx.db.get(livraison.alertId);
    const agriculteur = await ctx.db.get(livraison.farmerId);
    if (!alerte || !agriculteur) continue;
    sorties.push({
      deliveryId: livraison._id,
      contactRef: agriculteur.externalIdentityHash,
      text: alerte.message,
      organizationId: livraison.organizationId,
    });
  }
  return sorties;
};

export type DispatchResult =
  | { updated: true }
  | { updated: false; reason: "invalid_id" | "unknown_delivery" | "already_dispatched" };

export const applyDispatch = async (
  ctx: MutationCtx,
  deliveryIdBrut: string,
  providerMessageId: string,
): Promise<DispatchResult> => {
  const deliveryId = ctx.db.normalizeId("alertDeliveries", deliveryIdBrut);
  if (!deliveryId) return { updated: false, reason: "invalid_id" };
  const livraison = await ctx.db.get(deliveryId);
  if (!livraison) return { updated: false, reason: "unknown_delivery" };
  // Idempotent : une livraison déjà partie ne se réécrit pas et ne régresse pas.
  // Un rejeu du serveur ne double donc aucun message.
  if (livraison.providerMessageId) return { updated: false, reason: "already_dispatched" };
  await ctx.db.patch(deliveryId, { providerMessageId, state: "sent" });
  return { updated: true };
};

/** Livraisons prêtes à partir : état « created », texte et référence de contact. */
export const pendingDeliveries = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => selectPending(ctx, args.limit ?? 50),
});

/**
 * Le serveur confirme qu'une livraison est partie et fournit l'identifiant du
 * message provider. L'état passe à « sent » ; le reste du cycle (delivered,
 * read, replied) arrive ensuite par /whatsapp/callback.
 */
export const markDispatched = internalMutation({
  // deliveryId reçu en chaîne : l'appelant est le serveur WhatsApp, pas un
  // client Convex typé. Normalisé dans applyDispatch.
  args: { deliveryId: v.string(), providerMessageId: v.string() },
  handler: async (ctx, args) =>
    applyDispatch(ctx, args.deliveryId, args.providerMessageId),
});
