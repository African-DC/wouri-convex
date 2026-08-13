import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { ROLE_PRESETS } from "../authz/capabilities";
import { CAPABILITIES } from "../authz/capabilities";
import { LINGUIST_ORGANIZATION_ID } from "../testing/fixtures";

const modules = {
  "../_generated/api.js": () => import("../_generated/api.js"),
};

// LNG-04 — l'import du corpus doit pouvoir être rejoué sans dupliquer, et une
// correction doit versionner au lieu d'écraser. Ces tests exercent la logique
// d'upsert directement sur la base (l'import public exige une session).
describe("import du corpus IVR", () => {
  const upsert = async (
    t: TestConvex<typeof schema>,
    normalizedKey: string,
    language: string,
    text: string,
  ) =>
    t.run(async (ctx) => {
      const existing = await ctx.db
        .query("approvedPhrases")
        .withIndex("by_organizationId_and_language_and_normalizedKey", (q) =>
          q
            .eq("organizationId", "org-a")
            .eq("language", language)
            .eq("normalizedKey", normalizedKey),
        )
        .unique();
      const headId =
        existing?._id ??
        (await ctx.db.insert("approvedPhrases", {
          organizationId: "org-a",
          language,
          intent: "CONSEIL_PRODUCTION",
          culture: "CULTURE_RIZ",
          normalizedKey,
          status: "approved",
        }));
      const last = await ctx.db
        .query("approvedPhraseVersions")
        .withIndex("by_phraseId_and_version", (q) => q.eq("phraseId", headId))
        .order("desc")
        .first();
      if (last?.text === text) return { headId, version: last.version, ecrit: false };
      const version = (last?.version ?? 0) + 1;
      await ctx.db.insert("approvedPhraseVersions", {
        phraseId: headId,
        version,
        text,
        reviewerMemberId: "import-corpus-ivr",
        approvedAt: 1000,
      });
      return { headId, version, ecrit: true };
    });

  it("réimporter le même texte ne crée ni doublon ni version", async () => {
    const t = convexTest(schema, modules);
    const premier = await upsert(t, "riz_conseil_001", "dyu", "Aw ye malo senè...");
    const second = await upsert(t, "riz_conseil_001", "dyu", "Aw ye malo senè...");

    expect(premier.ecrit).toBe(true);
    expect(second.ecrit).toBe(false);
    expect(second.headId).toBe(premier.headId);

    const nbTetes = await t.run(async (ctx) =>
      (await ctx.db.query("approvedPhrases").collect()).length,
    );
    const nbVersions = await t.run(async (ctx) =>
      (await ctx.db.query("approvedPhraseVersions").collect()).length,
    );
    expect(nbTetes).toBe(1);
    expect(nbVersions).toBe(1);
  });

  it("un texte corrigé ajoute une version sans écraser la précédente", async () => {
    const t = convexTest(schema, modules);
    await upsert(t, "riz_conseil_001", "dyu", "Texte initial");
    const corrige = await upsert(t, "riz_conseil_001", "dyu", "Texte corrigé");

    expect(corrige.version).toBe(2);

    const versions = await t.run(async (ctx) =>
      ctx.db.query("approvedPhraseVersions").collect(),
    );
    expect(versions.map((v) => v.text).sort()).toEqual([
      "Texte corrigé",
      "Texte initial",
    ]);
  });

  it("les deux langues d'une entrée sont des têtes distinctes", async () => {
    const t = convexTest(schema, modules);
    const dyu = await upsert(t, "riz_conseil_001", "dyu", "Aw ye malo senè...");
    const fr = await upsert(t, "riz_conseil_001", "fr", "Plante ton riz en mai.");

    expect(dyu.headId).not.toBe(fr.headId);
    const langues = await t.run(async (ctx) =>
      (await ctx.db.query("approvedPhrases").collect()).map((p) => p.language).sort(),
    );
    expect(langues).toEqual(["dyu", "fr"]);
  });
});

// Modèle des acteurs corrigé par Marcel : le CNRA est une organisation cliente
// et fournisseuse d'agronomie qui diffuse ses campagnes ; le linguiste est un
// rôle transversal de la plateforme, rattaché à ADC.
describe("modèle des acteurs", () => {
  it("le CNRA peut publier ses alertes, pas seulement les rédiger", () => {
    expect(ROLE_PRESETS.cnraOperator).toContain(CAPABILITIES.alertsPublish);
  });

  it("le CNRA ne valide pas les langues", () => {
    expect(ROLE_PRESETS.cnraOperator).not.toContain(
      CAPABILITIES.linguisticValidate,
    );
  });

  it("le linguiste est rattaché à la plateforme ADC", () => {
    expect(LINGUIST_ORGANIZATION_ID).toBe("demo-adc");
  });

  it("le linguiste ne voit pas l'AI Ops ni l'administration plateforme", () => {
    expect(ROLE_PRESETS.linguist).not.toContain(CAPABILITIES.aiopsRead);
    expect(ROLE_PRESETS.linguist).not.toContain(CAPABILITIES.platformManage);
  });
});
