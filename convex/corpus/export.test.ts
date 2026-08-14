/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { construireExport } from "./export";

const modules = import.meta.glob("./../**/*.ts");

/* ADR-0025 / G09 — l'export est le seul chemin par lequel une correction
   validée dans la Console atteint l'agriculteur. Deux propriétés doivent tenir,
   sinon la boucle de validation se referme à vide :

   1. l'export n'expose que des entrées complètes (les deux langues), car le
      moteur ne sait pas servir une demi-entrée ;
   2. la révision change dès qu'une réponse est corrigée, sans quoi le moteur
      conclurait « rien n'a changé » et continuerait de servir l'ancienne. */

const semerEntree = async (
  ctx: Parameters<Parameters<ReturnType<typeof convexTest>["run"]>[0]>[0],
  cle: string,
  textes: { fr: string; dyu: string },
  instant = 1000,
) => {
  for (const [langue, texte] of [
    ["fr", textes.fr],
    ["dyu", textes.dyu],
  ] as const) {
    const phraseId = await ctx.db.insert("approvedPhrases", {
      organizationId: "org-a",
      language: langue,
      intent: "CONSEIL_PRODUCTION",
      culture: "CULTURE_CACAO",
      normalizedKey: cle,
      status: "approved",
    });
    await ctx.db.insert("approvedPhraseVersions", {
      phraseId,
      version: 1,
      text: texte,
      reviewerMemberId: "membre-1",
      approvedAt: instant,
    });
  }
};

describe("export du corpus vers le moteur", () => {
  it("apparie les deux langues en une entrée servable", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      semerEntree(ctx, "cacao_conseil_001", { fr: "Plante en mai.", dyu: "Aw ye sɛnɛ." }),
    );
    const sortie = await t.run((ctx) => construireExport(ctx));
    expect(sortie.total).toBe(1);
    expect(sortie.entries[0]).toMatchObject({
      id: "cacao_conseil_001",
      intent: "CONSEIL_PRODUCTION",
      reponse_fr: "Plante en mai.",
      reponse_bambara: "Aw ye sɛnɛ.",
    });
    // La culture est portée une seule fois même si les deux langues la déclarent.
    expect(sortie.entries[0].cultures).toEqual(["CULTURE_CACAO"]);
    expect(sortie.incompletes).toEqual([]);
  });

  it("n'exporte pas une entrée à moitié traduite, et la signale", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const phraseId = await ctx.db.insert("approvedPhrases", {
        organizationId: "org-a",
        language: "fr",
        intent: "QUESTION_ENGRAIS",
        normalizedKey: "orpheline_001",
        status: "approved",
      });
      await ctx.db.insert("approvedPhraseVersions", {
        phraseId,
        version: 1,
        text: "Seulement en français.",
        reviewerMemberId: "membre-1",
        approvedAt: 1000,
      });
    });
    const sortie = await t.run((ctx) => construireExport(ctx));
    // Servir une entrée sans sa traduction ferait répondre WOURI en français à
    // un agriculteur dioulaphone : on préfère l'omettre et le dire.
    expect(sortie.total).toBe(0);
    expect(sortie.incompletes).toEqual(["orpheline_001"]);
  });

  it("ignore une phrase non approuvée", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const phraseId = await ctx.db.insert("approvedPhrases", {
        organizationId: "org-a",
        language: "fr",
        intent: "SALUTATION",
        normalizedKey: "brouillon_001",
        status: "draft",
      });
      await ctx.db.insert("approvedPhraseVersions", {
        phraseId,
        version: 1,
        text: "Pas encore validée.",
        reviewerMemberId: "membre-1",
        approvedAt: 1000,
      });
    });
    const sortie = await t.run((ctx) => construireExport(ctx));
    expect(sortie.total).toBe(0);
    expect(sortie.incompletes).toEqual([]);
  });

  it("change de révision quand une réponse est corrigée", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      semerEntree(ctx, "cacao_conseil_001", { fr: "Ancienne.", dyu: "Kɔrɔlen." }),
    );
    const avant = await t.run((ctx) => construireExport(ctx));

    // Une correction promue ajoute une version, elle n'écrase jamais.
    await t.run(async (ctx) => {
      const phrase = await ctx.db
        .query("approvedPhrases")
        .filter((q) => q.eq(q.field("language"), "dyu"))
        .first();
      await ctx.db.insert("approvedPhraseVersions", {
        phraseId: phrase!._id,
        version: 2,
        text: "Kura.",
        reviewerMemberId: "membre-2",
        approvedAt: 5000,
      });
    });

    const apres = await t.run((ctx) => construireExport(ctx));
    // Sans ce changement de révision, le moteur conclurait « rien à faire ».
    expect(apres.revision).not.toBe(avant.revision);
    expect(apres.entries[0].reponse_bambara).toBe("Kura.");
    expect(apres.entries[0].version).toBe(2);
  });

  it("rend la même révision quand rien n'a changé", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      semerEntree(ctx, "cacao_conseil_001", { fr: "Stable.", dyu: "Sabati." }),
    );
    const premier = await t.run((ctx) => construireExport(ctx));
    const second = await t.run((ctx) => construireExport(ctx));
    // Propriété qui rend l'import idempotent côté moteur.
    expect(second.revision).toBe(premier.revision);
  });
});
