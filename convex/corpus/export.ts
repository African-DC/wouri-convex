import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";

// ADR-0025 / G09 — Convex est la source de vérité du corpus, Postgres en est
// l'index de service. Cette surface est ce que le moteur importe.
//
// Elle existe parce que le corpus vivait en double : 197 entrées côté moteur,
// 394 phrases côté Convex, sans lien. Une correction promue par un validateur
// n'atteignait donc jamais l'agriculteur : la boucle de validation était close
// à l'écran et sans effet en production.
//
// Le contrat est celui qu'attend le moteur (`reponse_fr` / `reponse_bambara`),
// pas la forme interne de Convex : c'est ici qu'on traduit, une fois, plutôt
// que de faire porter la conversion au script d'import.

// Le moteur sert le dioula sous le nom « bambara » (modèle mms-tts-bam,
// registre `bam`). On expose donc les deux clés attendues côté moteur.
const LANGUE_LOCALE = "dyu";
const LANGUE_PIVOT = "fr";

// Plafond de lecture. Le corpus pilote compte 197 entrées ; ce plafond laisse
// de la marge tout en bornant la requête.
const PLAFOND = 4000;

type Entree = {
  id: string;
  intent: string;
  cultures: string[];
  reponse_fr: string | null;
  reponse_bambara: string | null;
  version: number;
};

/**
 * Corpus approuvé, regroupé par clé normalisée, avec une révision globale.
 *
 * La révision permet au moteur de ne réimporter que s'il y a eu un changement.
 * Elle combine le nombre de versions et l'horodatage le plus récent : une
 * promotion crée toujours une version, donc le compte bouge ; une réapprobation
 * déplace l'horodatage. Aucune table supplémentaire n'est nécessaire.
 */
/**
 * Coeur de l export, isole de la couche Convex pour etre testable directement.
 * convex-test ne resout pas une internalQuery par reference depuis ce dossier ;
 * separer le calcul evite de dependre de cette resolution.
 */
export const construireExport = async (ctx: QueryCtx, limite?: number) => {
    const plafond = Math.min(limite ?? PLAFOND, PLAFOND);

    const phrases = await ctx.db
      .query("approvedPhrases")
      .filter((q) => q.eq(q.field("status"), "approved"))
      .take(plafond);

    const parCle = new Map<string, Entree>();
    let versionsVues = 0;
    let dernierChangement = 0;

    for (const phrase of phrases) {
      const derniere = await ctx.db
        .query("approvedPhraseVersions")
        .withIndex("by_phraseId_and_version", (q) => q.eq("phraseId", phrase._id))
        .order("desc")
        .first();
      if (!derniere) continue;

      versionsVues += 1;
      const horodatage = derniere.approvedAt ?? derniere._creationTime;
      if (horodatage > dernierChangement) dernierChangement = horodatage;

      const existante = parCle.get(phrase.normalizedKey) ?? {
        id: phrase.normalizedKey,
        intent: phrase.intent,
        cultures: [],
        reponse_fr: null,
        reponse_bambara: null,
        version: 0,
      };

      if (phrase.language === LANGUE_PIVOT) existante.reponse_fr = derniere.text;
      else if (phrase.language === LANGUE_LOCALE) existante.reponse_bambara = derniere.text;

      // La culture est portée par la phrase, pas par la version : deux langues
      // de la même entrée peuvent la déclarer, on ne la duplique pas.
      if (phrase.culture && !existante.cultures.includes(phrase.culture)) {
        existante.cultures.push(phrase.culture);
      }
      // La version de l'entrée est la plus haute de ses langues : si l'une des
      // deux a été corrigée, l'entrée entière est réputée modifiée.
      existante.version = Math.max(existante.version, derniere.version);

      parCle.set(phrase.normalizedKey, existante);
    }

    // Une entrée sans les deux langues n'est pas servable par le moteur : on la
    // signale plutôt que de l'exporter à moitié.
    const completes: Entree[] = [];
    const incompletes: string[] = [];
    for (const entree of parCle.values()) {
      if (entree.reponse_fr && entree.reponse_bambara) completes.push(entree);
      else incompletes.push(entree.id);
    }

    completes.sort((a, b) => a.id.localeCompare(b.id));

    return {
      // Révision déterministe : même contenu, même révision.
      revision: `${versionsVues}-${dernierChangement}`,
      generatedAt: Date.now(),
      total: completes.length,
      tronque: phrases.length >= plafond,
      incompletes,
      entries: completes,
    };
};

export const corpusForEngine = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => construireExport(ctx, args.limit),
});
