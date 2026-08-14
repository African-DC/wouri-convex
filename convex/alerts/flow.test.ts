/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { createFarmerForOrg, addZoneLink, addConsent } from "../farmers/model";
import {
  createAlertForOrg,
  addAudienceRule,
  createDeliveriesForOrg,
  resolveAudience,
  setDeliveryStateByAlertAndFarmer,
} from "../alerts/model";
import { resolveAlertContext } from "../conversations/model";
import { ALERT_CONSENT_PURPOSE } from "../alerts/audience";

// convex-test exige le map COMPLET des modules pour resoudre les fonctions
// enregistrees : un map partiel les rend silencieusement inatteignables.
const modules = import.meta.glob("./../**/*.ts");

// G05 / QA-03 — an alert reaches a targeted farmer, the delivery advances to
// "replied", and the conversation recovers the originating alert (its message,
// date and zone) without the farmer repeating it.
describe("alert to conversation flow", () => {
  it("targets, delivers, replies and recovers the alert context", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = 1000;
      const farmer = await createFarmerForOrg(ctx, "org-a", "a1", now);
      await addZoneLink(ctx, "org-a", farmer, "abidjan-nord");
      // ALT-05 : l opt-in conditionne desormais l appartenance a l audience.
      await addConsent(ctx, farmer, ALERT_CONSENT_PURPOSE, "v1", "granted", "test", now);
      const alertId = await createAlertForOrg(
        ctx,
        "org-a",
        "member-a",
        { message: "Forte pluie prevue demain" },
        now,
      );
      await addAudienceRule(ctx, "org-a", alertId, {
        kind: "zone",
        targetKey: "abidjan-nord",
      });
      const audience = await resolveAudience(ctx, "org-a", [
        { kind: "zone", targetKey: "abidjan-nord" },
      ]);
      await createDeliveriesForOrg(ctx, "org-a", alertId, audience, now);
      const deliveryId = await setDeliveryStateByAlertAndFarmer(
        ctx,
        alertId,
        farmer,
        "replied",
      );
      const contextId = await ctx.db.insert("conversationContexts", {
        organizationId: "org-a",
        farmerId: farmer,
        agentThreadId: "thread-1",
        channel: "whatsapp",
        preferredLanguage: "dyu",
        originAlertId: alertId,
        status: "open",
        lastActivityAt: now,
        createdAt: now,
      });
      return { alertId, farmer, deliveryId, contextId, audienceSize: audience.length };
    });

    expect(ids.audienceSize).toBe(1);
    expect(ids.deliveryId).not.toBeNull();

    const recovered = await t.run((ctx) =>
      resolveAlertContext(ctx, "org-a", ids.contextId),
    );
    expect(recovered?.alert.message).toBe("Forte pluie prevue demain");
    expect(recovered?.zones).toContain("abidjan-nord");

    // Another organization cannot recover this conversation's context.
    expect(
      await t.run((ctx) => resolveAlertContext(ctx, "org-b", ids.contextId)),
    ).toBeNull();
  });

  it("delivery state advances monotonically (out-of-order callbacks)", async () => {
    const t = convexTest(schema, modules);
    const { alertId, farmer } = await t.run(async (ctx) => {
      const farmer = await createFarmerForOrg(ctx, "org-a", "a1", 1);
      const alertId = await createAlertForOrg(ctx, "org-a", "m", { message: "x" }, 1);
      await createDeliveriesForOrg(ctx, "org-a", alertId, [farmer], 1);
      return { alertId, farmer };
    });
    await t.run((ctx) =>
      setDeliveryStateByAlertAndFarmer(ctx, alertId, farmer, "read"),
    );
    // A late "delivered" callback must NOT regress a delivery already "read".
    await t.run((ctx) =>
      setDeliveryStateByAlertAndFarmer(ctx, alertId, farmer, "delivered"),
    );
    const state = await t.run(async (ctx) => {
      const delivery = await ctx.db
        .query("alertDeliveries")
        .withIndex("by_alertId_and_farmerId", (q) =>
          q.eq("alertId", alertId).eq("farmerId", farmer),
        )
        .first();
      return delivery?.state;
    });
    expect(state).toBe("read");
  });

  it("counts every failure and lets a retry recover", async () => {
    const t = convexTest(schema, modules);
    const { alertId, farmer } = await t.run(async (ctx) => {
      const farmer = await createFarmerForOrg(ctx, "org-a", "a1", 1);
      const alertId = await createAlertForOrg(ctx, "org-a", "m", { message: "x" }, 1);
      await createDeliveriesForOrg(ctx, "org-a", alertId, [farmer], 1);
      return { alertId, farmer };
    });
    const readDelivery = () =>
      t.run(async (ctx) =>
        ctx.db
          .query("alertDeliveries")
          .withIndex("by_alertId_and_farmerId", (q) =>
            q.eq("alertId", alertId).eq("farmerId", farmer),
          )
          .first(),
      );

    // Two failed callbacks must both be counted: the attempt counter is what
    // drives retry and alerting, so swallowing the second would freeze it at 1.
    for (const _ of [0, 1]) {
      await t.run((ctx) =>
        setDeliveryStateByAlertAndFarmer(ctx, alertId, farmer, "failed"),
      );
    }
    expect((await readDelivery())?.attemptCount).toBe(2);

    // A retry that finally succeeds must be able to leave the failed state.
    await t.run((ctx) =>
      setDeliveryStateByAlertAndFarmer(ctx, alertId, farmer, "sent"),
    );
    expect((await readDelivery())?.state).toBe("sent");
  });
});
