/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { createFarmerForOrg, addConsent, isOptedIn } from "../farmers/model";
import { ALERT_CONSENT_PURPOSE } from "../alerts/audience";
import { applyOptOut } from "./optout";

const modules = import.meta.glob("./../**/*.ts");

/* Chantier 3 — un STOP entrant retire le consentement à la diffusion. Le contact
   est désigné par sa référence (empreinte), jamais par un numéro. */

const preparerConsentant = async (
  ctx: Parameters<Parameters<ReturnType<typeof convexTest>["run"]>[0]>[0],
) => {
  const now = 1000;
  const farmerId = await createFarmerForOrg(ctx, "org-a", "hash-abc", now);
  await addConsent(
    ctx,
    farmerId,
    ALERT_CONSENT_PURPOSE,
    "v1",
    "granted",
    "console",
    now,
  );
  return farmerId;
};

describe("opt-out par STOP", () => {
  it("retire le consentement et sort l'agriculteur de l'audience", async () => {
    const t = convexTest(schema, modules);
    const farmerId = await t.run(preparerConsentant);
    const res = await t.run((ctx) => applyOptOut(ctx, "org-a", "hash-abc", 2000));
    expect(res).toEqual({ applied: true, farmerId });
    const optedIn = await t.run((ctx) =>
      isOptedIn(ctx, farmerId as never, ALERT_CONSENT_PURPOSE),
    );
    expect(optedIn).toBe(false);
  });

  it("trace le retrait avec un acteur système", async () => {
    const t = convexTest(schema, modules);
    await t.run(preparerConsentant);
    await t.run((ctx) => applyOptOut(ctx, "org-a", "hash-abc", 2000));
    const audit = await t.run((ctx) =>
      ctx.db
        .query("auditLogs")
        .filter((q) => q.eq(q.field("action"), "farmer.consent.withdraw"))
        .first(),
    );
    expect(audit?.actorSubject).toBe("system:whatsapp");
  });

  it("est idempotent : un second STOP ne réécrit rien", async () => {
    const t = convexTest(schema, modules);
    await t.run(preparerConsentant);
    await t.run((ctx) => applyOptOut(ctx, "org-a", "hash-abc", 2000));
    const rejeu = await t.run((ctx) => applyOptOut(ctx, "org-a", "hash-abc", 3000));
    expect(rejeu).toEqual({ applied: false, reason: "already_withdrawn" });
  });

  it("refuse proprement un contact inconnu", async () => {
    const t = convexTest(schema, modules);
    const res = await t.run((ctx) => applyOptOut(ctx, "org-a", "hash-inconnu", 2000));
    expect(res).toEqual({ applied: false, reason: "unknown_contact" });
  });
});
