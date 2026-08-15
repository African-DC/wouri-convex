/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { chercherTraduction, normaliserPourComparaison } from "./translate";

const modules = import.meta.glob("./../**/*.ts");

/* Chantier 4 — la façade publique sert le corpus validé, jamais de la
   traduction inventée. On prouve les deux seules issues : une paire attestée
   trouvée avec sa provenance, ou un aveu honnête de non-correspondance. */

// Prépare une entrée approuvée fr <-> dyu, appariée par la même clé normalisée.
const preparerEntree = async (
  ctx: Parameters<Parameters<ReturnType<typeof convexTest>["run"]>[0]>[0],
) => {
  const now = 1000;
  for (const [langue, texte] of [
    ["fr", "La pluie est probable cet apres-midi."],
    ["dyu", "Sanji be se ka na wula kofe."],
  ] as const) {
    const phraseId = await ctx.db.insert("approvedPhrases", {
      organizationId: "org-a",
      language: langue,
      intent: "CONSEIL_METEO",
      culture: "cacao",
      normalizedKey: "meteo-pluie-aprem",
      status: "approved",
    });
    await ctx.db.insert("approvedPhraseVersions", {
      phraseId,
      version: 1,
      text: texte,
      reviewerMemberId: "membre-1",
      approvedAt: now,
    });
  }
};

describe("façade publique de traduction", () => {
  it("normalise accents, casse et ponctuation pour la comparaison", () => {
    expect(normaliserPourComparaison("  La Pluie, cet APRÈS-midi !  ")).toBe(
      "la pluie cet apres midi",
    );
  });

  it("rend la paire validée avec sa provenance quand la phrase est au corpus", async () => {
    const t = convexTest(schema, modules);
    await t.run(preparerEntree);
    // Entrée avec accents et ponctuation différents : la normalisation doit relier.
    const res = await t.run((ctx) =>
      chercherTraduction(ctx, "fr", "dyu", "la pluie est probable cet apres midi"),
    );
    expect(res).toMatchObject({
      match: true,
      source: "corpus_valide",
      texte: "Sanji be se ka na wula kofe.",
      intent: "CONSEIL_METEO",
    });
  });

  it("traduit aussi dans l'autre sens, dioula vers français", async () => {
    const t = convexTest(schema, modules);
    await t.run(preparerEntree);
    const res = await t.run((ctx) =>
      chercherTraduction(ctx, "dyu", "fr", "Sanji be se ka na wula kofe."),
    );
    expect(res).toMatchObject({ match: true, texte: "La pluie est probable cet apres-midi." });
  });

  it("avoue une non-correspondance plutôt que d'inventer", async () => {
    const t = convexTest(schema, modules);
    await t.run(preparerEntree);
    const res = await t.run((ctx) =>
      chercherTraduction(ctx, "fr", "dyu", "Combien coûte un tracteur ?"),
    );
    expect(res).toEqual({ match: false, raison: "hors_corpus" });
  });

  it("signale une langue non couverte sans prétendre traduire", async () => {
    const t = convexTest(schema, modules);
    await t.run(preparerEntree);
    const res = await t.run((ctx) =>
      chercherTraduction(ctx, "fr", "bci", "La pluie est probable cet apres-midi."),
    );
    expect(res).toEqual({ match: false, raison: "langue_non_couverte" });
  });

  it("refuse une entrée vide", async () => {
    const t = convexTest(schema, modules);
    const res = await t.run((ctx) => chercherTraduction(ctx, "fr", "dyu", "   "));
    expect(res).toEqual({ match: false, raison: "entree_vide" });
  });
});
