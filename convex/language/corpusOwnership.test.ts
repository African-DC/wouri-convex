/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { assertPlatformOrganization } from "../aiops/shared";
import { WouriError } from "../lib/errors";

const modules = import.meta.glob("./../**/*.ts");

/* ADR-0025 — le corpus est une propriété d'ADC. La langue validée est un actif de
   la plateforme, servi à toutes les organisations ; une coopérative cliente le
   consomme, elle ne le valide jamais (lui demander de valider reviendrait à lui
   faire faire le travail d'ADC). Les mutations d'écriture du corpus
   (promoteToApprovedPhrase, promoteToGlossary, promoteToCorpus, importCorpus)
   appliquent donc assertPlatformOrganization. Ce test verrouille cette règle au
   niveau de la garde qu'elles partagent. */

const auth = (organizationId: string) => ({
  organizationId,
  memberId: "membre-1",
  rolePolicyId: "policy-1",
  permissions: [],
});

const seedProfil = (
  t: ReturnType<typeof convexTest>,
  organizationId: string,
  kind: "adc" | "cooperative",
) =>
  t.run((ctx) =>
    ctx.db.insert("organizationProfiles", { organizationId, kind, status: "active" }),
  );

describe("propriété du corpus (ADC seul valide)", () => {
  it("laisse passer l'organisation plateforme ADC", async () => {
    const t = convexTest(schema, modules);
    await seedProfil(t, "org-adc", "adc");
    // Ne lève pas : la plateforme a le droit de valider le corpus.
    await expect(
      t.run((ctx) => assertPlatformOrganization(ctx, auth("org-adc"))),
    ).resolves.toBeNull();
  });

  it("refuse une coopérative cliente, même dotée du droit de validation", async () => {
    const t = convexTest(schema, modules);
    await seedProfil(t, "org-coop", "cooperative");
    await expect(
      t.run((ctx) => assertPlatformOrganization(ctx, auth("org-coop"))),
    ).rejects.toBeInstanceOf(WouriError);
  });
});
