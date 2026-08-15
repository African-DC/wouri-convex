import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { construireExport } from "../corpus/export";

// Chantier 4 — la façade publique de traduction, servie DEPUIS LE CORPUS VALIDÉ.
//
// La démo du site ne montre pas de la traduction machine (le maillon faible
// reconnu de l'audit) : elle montre ce que WOURI a de singulier, un corpus de
// réponses agricoles validées par des humains. On y compare une entrée à la
// forme normalisée des phrases approuvées. Deux issues seulement : la phrase est
// dans le corpus et on rend la paire attestée avec sa provenance, ou elle n'y
// est pas et on le dit. Jamais d'invention.
//
// Convex est ici la source de vérité (ADR-0025) : cette façade lit exactement ce
// que le validateur a approuvé dans la Console, sans détour par un index dérivé.

// Langues réellement couvertes par le corpus pilote : français pivot et dioula.
// Toute autre langue de l'interface (baoulé, etc.) répond « non couverte » plutôt
// que de laisser croire à une traduction.
const LANGUES_COUVERTES = new Set(["fr", "dyu"]);

/**
 * Forme de comparaison : minuscules, sans diacritiques, ponctuation réduite,
 * espaces normalisés. On compare des formes normalisées, jamais les textes
 * bruts, pour qu'un accent ou une virgule ne fasse pas manquer une paire qui
 * existe. La comparaison reste exacte sur cette forme : aucune approximation
 * sémantique, donc aucune fausse correspondance inventée.
 */
export function normaliserPourComparaison(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Traduction =
  | {
      match: true;
      source: "corpus_valide";
      texte: string;
      intent: string;
      cultures: string[];
    }
  | { match: false; raison: "hors_corpus" | "langue_non_couverte" | "entree_vide" };

/**
 * Cœur isolé de la couche Convex, testable directement : convex-test ne résout
 * pas une internalQuery par référence depuis ce dossier.
 */
export const chercherTraduction = async (
  ctx: QueryCtx,
  langueSource: string,
  langueCible: string,
  texte: string,
): Promise<Traduction> => {
  if (!LANGUES_COUVERTES.has(langueSource) || !LANGUES_COUVERTES.has(langueCible)) {
    return { match: false, raison: "langue_non_couverte" };
  }
  const recherche = normaliserPourComparaison(texte);
  if (!recherche) return { match: false, raison: "entree_vide" };

  // Le corpus pilote est petit (≈197 entrées) et déjà apparié fr/dyu par
  // construireExport : on relit la même source que le moteur, sans dupliquer la
  // logique d'appariement.
  const corpus = await construireExport(ctx);
  for (const entree of corpus.entries) {
    const cote = langueSource === "fr" ? entree.reponse_fr : entree.reponse_bambara;
    if (!cote) continue;
    if (normaliserPourComparaison(cote) !== recherche) continue;

    const cible = langueCible === "fr" ? entree.reponse_fr : entree.reponse_bambara;
    if (!cible) return { match: false, raison: "hors_corpus" };
    return {
      match: true,
      source: "corpus_valide",
      texte: cible,
      intent: entree.intent,
      cultures: entree.cultures,
    };
  }
  return { match: false, raison: "hors_corpus" };
};

/** Recherche publique d'une traduction validée. Sans effet de bord, sans PII. */
export const lookupTranslation = internalQuery({
  args: { source: v.string(), target: v.string(), text: v.string() },
  handler: (ctx, args) => chercherTraduction(ctx, args.source, args.target, args.text),
});
