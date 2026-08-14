/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { createFarmerForOrg } from "../farmers/model";
import { createAlertForOrg, createDeliveriesForOrg } from "../alerts/model";
import { setDeliveryStateByProviderMessageId } from "../alerts/model";
import { selectPending, applyDispatch } from "./dispatch";

const modules = import.meta.glob("./../**/*.ts");

/* Chantier 2 — cycle de vie d'une livraison en mode pull. Le serveur WhatsApp
   récupère les livraisons « created », les envoie, rapporte l'identifiant, puis
   confirme les statuts. On prouve le cycle sans jamais exposer de numéro. */

const preparerLivraison = async (
  ctx: Parameters<Parameters<ReturnType<typeof convexTest>["run"]>[0]>[0],
) => {
  const now = 1000;
  const farmer = await createFarmerForOrg(ctx, "org-a", "hash-abc", now);
  const alertId = await createAlertForOrg(
    ctx,
    "org-a",
    "membre-1",
    { message: "Forte pluie demain." },
    now,
  );
  await createDeliveriesForOrg(ctx, "org-a", alertId, [farmer], now);
  return { farmer, alertId };
};

describe("diffusion en pull", () => {
  it("expose la livraison à envoyer avec la référence de contact, jamais le numéro", async () => {
    const t = convexTest(schema, modules);
    await t.run(preparerLivraison);
    const pending = await t.run((ctx) => selectPending(ctx, 50));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      contactRef: "hash-abc",
      text: "Forte pluie demain.",
      organizationId: "org-a",
    });
    // Aucune clé « phone » / « numero » : le numéro n'existe pas côté Convex.
    expect(Object.keys(pending[0])).not.toContain("phone");
  });

  it("marque une livraison partie et la retire des envois en attente", async () => {
    const t = convexTest(schema, modules);
    const deliveryId = await t.run(async (ctx) => {
      await preparerLivraison(ctx);
      const [p] = await selectPending(ctx, 50);
      return p.deliveryId;
    });
    const res = await t.run((ctx) => applyDispatch(ctx, deliveryId, "wa-msg-1"));
    expect(res).toEqual({ updated: true });
    // Partie = plus dans la file d'attente.
    const restant = await t.run((ctx) => selectPending(ctx, 50));
    expect(restant).toHaveLength(0);
  });

  it("est idempotent : un rejeu ne double pas l'envoi", async () => {
    const t = convexTest(schema, modules);
    const deliveryId = await t.run(async (ctx) => {
      await preparerLivraison(ctx);
      const [p] = await selectPending(ctx, 50);
      return p.deliveryId;
    });
    await t.run((ctx) => applyDispatch(ctx, deliveryId, "wa-msg-1"));
    const rejeu = await t.run((ctx) => applyDispatch(ctx, deliveryId, "wa-msg-2"));
    expect(rejeu).toEqual({ updated: false, reason: "already_dispatched" });
    // Le premier identifiant reste, le rejeu ne l'écrase pas.
    const livraison = await t.run((ctx) =>
      ctx.db
        .query("alertDeliveries")
        .withIndex("by_state_and_createdAt", (q) => q.eq("state", "sent"))
        .first(),
    );
    expect(livraison?.providerMessageId).toBe("wa-msg-1");
  });

  it("refuse proprement un identifiant mal formé", async () => {
    const t = convexTest(schema, modules);
    const res = await t.run((ctx) => applyDispatch(ctx, "pas-un-id", "wa-msg-1"));
    expect(res).toEqual({ updated: false, reason: "invalid_id" });
  });

  it("le callback provider fait avancer l'état après l'envoi", async () => {
    const t = convexTest(schema, modules);
    const deliveryId = await t.run(async (ctx) => {
      await preparerLivraison(ctx);
      const [p] = await selectPending(ctx, 50);
      await applyDispatch(ctx, p.deliveryId, "wa-msg-1");
      return p.deliveryId;
    });
    // Le serveur confirme la remise. Rapprochement par providerMessageId.
    await t.run((ctx) =>
      setDeliveryStateByProviderMessageId(ctx, "whatsapp", "wa-msg-1", "delivered"),
    );
    const etat = await t.run((ctx) => ctx.db.get(deliveryId as never));
    expect((etat as { state: string }).state).toBe("delivered");
  });
});
