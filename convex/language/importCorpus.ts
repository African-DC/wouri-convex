import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { authorizeMutation, CAPABILITIES } from "../authorization";
import { recordAudit } from "../lib/audit";
import { resolveAuditActor } from "../lib/actor";
import { createSource, createSourceVersion } from "../knowledge/model";

// LNG-04 — import du corpus IVR existant dans la gouvernance versionnee.
//
// Le corpus historique vit dans dictionnaires/corpus_ivr.json : chaque entree
// porte un identifiant stable, une intention, des cultures, une reponse en
// langue locale et sa contrepartie francaise. Cet import le fait entrer dans
// Convex SANS rien ecraser : chaque phrase devient une tete `approvedPhrases`
// plus une version numerotee, et toute reexecution qui change un texte ajoute
// une version au lieu de remplacer la precedente.
//
// Choix de langue (decide avec Marcel) : le champ `reponse_bambara` est importe
// en `dyu`, la langue que le produit sert reellement au pilote ivoirien, mais la
// provenance « corpus IVR, base bambara/dioula » est attachee a chaque version.
// On ne maquille pas l'origine : le validateur pourra corriger entree par
// entree, et l'historique dira toujours d'ou venait le texte initial.
//
// Les `phrases_attestees` ne sont pas importees : elles servent au fine-tuning
// ASR, pas au service des reponses.

const IMPORT_REVIEWER = "import-corpus-ivr";

const corpusEntryValidator = v.object({
  id: v.string(),
  intent: v.string(),
  cultures: v.optional(v.array(v.string())),
  reponse_bambara: v.optional(v.string()),
  reponse_fr: v.optional(v.string()),
});

type PhraseInput = {
  language: string;
  intent: string;
  culture?: string;
  normalizedKey: string;
  text: string;
};

type Outcome = "created" | "versioned" | "unchanged";

// Idempotence : la tete est identifiee par (organisation, langue, cle). Une
// nouvelle version n'est ajoutee que si le texte a reellement change.
const upsertPhrase = async (
  ctx: MutationCtx,
  organizationId: string,
  input: PhraseInput,
  sourceVersionId: Id<"knowledgeSourceVersions">,
  now: number,
): Promise<Outcome> => {
  const existing = await ctx.db
    .query("approvedPhrases")
    .withIndex("by_organizationId_and_language_and_normalizedKey", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("language", input.language)
        .eq("normalizedKey", input.normalizedKey),
    )
    .unique();

  const headId =
    existing?._id ??
    (await ctx.db.insert("approvedPhrases", {
      organizationId,
      language: input.language,
      intent: input.intent,
      ...(input.culture === undefined ? {} : { culture: input.culture }),
      normalizedKey: input.normalizedKey,
      status: "approved",
    }));

  const last = await ctx.db
    .query("approvedPhraseVersions")
    .withIndex("by_phraseId_and_version", (q) => q.eq("phraseId", headId))
    .order("desc")
    .first();

  if (last?.text === input.text) return "unchanged";

  await ctx.db.insert("approvedPhraseVersions", {
    phraseId: headId,
    version: (last?.version ?? 0) + 1,
    text: input.text,
    reviewerMemberId: IMPORT_REVIEWER,
    sourceVersionId,
    approvedAt: now,
  });

  return last ? "versioned" : "created";
};

const importArgs = {
  // Version declaree du corpus importe (ex : "2.4.1"), tracee en provenance.
  corpusVersion: v.string(),
  entries: v.array(corpusEntryValidator),
  dryRun: v.optional(v.boolean()),
};

type ImportArgs = {
  corpusVersion: string;
  entries: Array<{
    id: string;
    intent: string;
    cultures?: string[];
    reponse_bambara?: string;
    reponse_fr?: string;
  }>;
  dryRun?: boolean;
};

// Coeur de l'import, partage par la surface publique (console, autorisee) et la
// surface interne (verification staging en ligne de commande). Une seule
// implementation, donc un seul comportement a garantir.
const runImport = async (
  ctx: MutationCtx,
  organizationId: string,
  actor: { memberId: string } | null,
  args: ImportArgs,
) => {
    const now = Date.now();

    // Ce que l'import produirait, sans rien ecrire.
    const planned = args.entries.reduce(
      (total, entry) =>
        total +
        (entry.reponse_bambara ? 1 : 0) +
        (entry.reponse_fr ? 1 : 0),
      0,
    );
    if (args.dryRun) {
      return {
        mode: "dryRun" as const,
        entreesLues: args.entries.length,
        phrasesPrevues: planned,
        langues: ["dyu", "fr"],
      };
    }

    // Provenance : une source dediee au corpus IVR, une version par import.
    const locator = `corpus-ivr://${organizationId}`;
    const source =
      (await ctx.db
        .query("knowledgeSources")
        .withIndex("by_canonicalLocator", (q) =>
          q.eq("canonicalLocator", locator),
        )
        .unique()) ?? null;
    const sourceId =
      source?._id ??
      (await createSource(ctx, {
        organizationId: organizationId,
        visibility: "organization",
        authority: "WOURI — corpus IVR",
        license: "interne",
        canonicalLocator: locator,
      }));
    const sourceVersionId = await createSourceVersion(ctx, {
      sourceId,
      version: args.corpusVersion,
      contentHash: `${args.entries.length}-entrees`,
      acquiredAt: now,
      acquisitionMethod: "import console",
      publisherMetadata:
        "Corpus IVR historique, reponses en base bambara/dioula servies en dyu.",
    });

    const totals: Record<Outcome, number> = {
      created: 0,
      versioned: 0,
      unchanged: 0,
    };

    for (const entry of args.entries) {
      const culture = entry.cultures?.[0];
      const phrases: PhraseInput[] = [];
      if (entry.reponse_bambara) {
        phrases.push({
          language: "dyu",
          intent: entry.intent,
          ...(culture === undefined ? {} : { culture }),
          normalizedKey: entry.id,
          text: entry.reponse_bambara,
        });
      }
      if (entry.reponse_fr) {
        phrases.push({
          language: "fr",
          intent: entry.intent,
          ...(culture === undefined ? {} : { culture }),
          normalizedKey: entry.id,
          text: entry.reponse_fr,
        });
      }
      for (const phrase of phrases) {
        const outcome = await upsertPhrase(
          ctx,
          organizationId,
          phrase,
          sourceVersionId,
          now,
        );
        totals[outcome] += 1;
      }
    }

    await recordAudit(
      ctx,
      {
        organizationId: organizationId,
        ...(actor
          ? await resolveAuditActor(ctx, actor)
          : { actorSubject: IMPORT_REVIEWER, actorMemberId: IMPORT_REVIEWER }),
        action: "linguistic.corpus.import",
        resourceType: "knowledgeSourceVersions",
        resourceId: sourceVersionId,
        after: { corpusVersion: args.corpusVersion, ...totals },
      },
      now,
    );

    return {
      mode: "execute" as const,
      corpusVersion: args.corpusVersion,
      sourceVersionId,
      entreesLues: args.entries.length,
      creees: totals.created,
      versionnees: totals.versioned,
      inchangees: totals.unchanged,
    };
};

// Surface publique consommee par la console : l'organisation vient de la
// session, jamais d'un parametre, et la capability est verifiee.
export const importCorpus = mutation({
  args: importArgs,
  handler: async (ctx, args) => {
    const auth = await authorizeMutation(ctx, {
      permission: CAPABILITIES.linguisticValidate,
    });
    return runImport(ctx, auth.organizationId, auth, args);
  },
});

// Surface interne : verification du chargement sur staging en ligne de commande,
// hors session. Non exposee au client.
export const importCorpusInternal = internalMutation({
  args: { ...importArgs, organizationId: v.string() },
  handler: async (ctx, args) => {
    const { organizationId, ...rest } = args;
    return runImport(ctx, organizationId, null, rest);
  },
});
