import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

// DEV-01 / DEV-02 / DEV-04 — surface de diagnostic pour le serveur MCP et la
// CLI WOURI.
//
// Politique, non negociable :
// - LECTURE SEULE. Aucune mutation n'est exposee ici, un agent de diagnostic ne
//   doit jamais pouvoir modifier l'etat.
// - Fonctions INTERNES : elles ne sont pas appelables depuis un navigateur,
//   seulement par un operateur muni d'une cle de deploiement.
// - Aucune donnee personnelle : on renvoie des identifiants, des statuts, des
//   compteurs et des metadonnees, jamais le contenu des messages ni le
//   raisonnement d'un modele.
//
// L'objectif est de diagnostiquer un incident depuis une trace, sans acces brut
// a la base.

const CAP_LISTE = 100;

// @reflete aiops/health:health
export const health = internalQuery({
  args: {},
  handler: async (ctx) => {
    const runtime = globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    };
    const [organisations, traces, erreurs] = await Promise.all([
      ctx.db.query("organizationProfiles").take(CAP_LISTE),
      ctx.db.query("executionTraces").take(CAP_LISTE),
      ctx.db.query("errorReports").take(CAP_LISTE),
    ]);
    return {
      environnement: runtime.process?.env?.WOURI_ENV ?? "development",
      organisations: organisations.length,
      organisationsActives: organisations.filter((o) => o.status === "active").length,
      tracesRecentes: traces.length,
      erreursRecentes: erreurs.length,
      abstentions: traces.filter((t) => t.resultStatus === "abstained").length,
      echecs: traces.filter((t) => t.resultStatus === "failed").length,
    };
  },
});

// @reflete aiops/traces:listTraces
export const traces = internalQuery({
  args: {
    resultStatus: v.optional(
      v.union(
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("abstained"),
        v.literal("failed"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, CAP_LISTE);
    const rows = args.resultStatus
      ? await ctx.db
          .query("executionTraces")
          .withIndex("by_resultStatus_and_startedAt", (q) =>
            q.eq("resultStatus", args.resultStatus!),
          )
          .order("desc")
          .take(limit)
      : await ctx.db.query("executionTraces").order("desc").take(limit);
    return rows.map((trace) => ({
      id: trace._id,
      statut: trace.resultStatus,
      intention: trace.intent ?? null,
      langue: trace.language ?? null,
      erreur: trace.errorType ?? null,
      dureeMs: trace.latencyMs ?? null,
      demarreeA: trace.startedAt,
    }));
  },
});

// @reflete aiops/traces:getTrace
export const trace = internalQuery({
  args: { traceId: v.id("executionTraces") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.traceId);
    if (!found) return null;
    const steps = await ctx.db
      .query("executionTraceSteps")
      .withIndex("by_traceId_and_ordinal", (q) => q.eq("traceId", args.traceId))
      .order("asc")
      .take(200);
    return {
      id: found._id,
      statut: found.resultStatus,
      intention: found.intent ?? null,
      langue: found.language ?? null,
      erreur: found.errorType ?? null,
      dureeMs: found.latencyMs ?? null,
      prompt: found.promptKey ? `${found.promptKey} v${found.promptVersion ?? "?"}` : null,
      politique: found.policyKey ? `${found.policyKey} v${found.policyVersion ?? "?"}` : null,
      modele: found.modelConfigKey
        ? `${found.modelConfigKey} v${found.modelConfigVersion ?? "?"}`
        : null,
      etapes: steps.map((step) => ({
        ordre: step.ordinal,
        type: step.kind,
        nom: step.name,
        statut: step.status,
        dureeMs: step.latencyMs ?? null,
      })),
    };
  },
});

// @reflete aiops/traces:listErrors
export const errors = internalQuery({
  args: { errorType: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, CAP_LISTE);
    const rows = args.errorType
      ? await ctx.db
          .query("errorReports")
          .withIndex("by_errorType_and_createdAt", (q) =>
            q.eq("errorType", args.errorType!),
          )
          .order("desc")
          .take(limit)
      : await ctx.db.query("errorReports").order("desc").take(limit);
    return rows.map((row) => ({
      id: row._id,
      type: row.errorType,
      message: row.message,
      traceId: row.traceId ?? null,
      creeA: row.createdAt,
    }));
  },
});

// @reflete knowledge/queries:listKnowledgeSources @reflete knowledge/queries:getProvenance
export const sources = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, CAP_LISTE);
    const rows = await ctx.db.query("knowledgeSources").take(limit);
    return Promise.all(
      rows.map(async (source) => {
        const derniere = await ctx.db
          .query("knowledgeSourceVersions")
          .withIndex("by_sourceId_and_version", (q) => q.eq("sourceId", source._id))
          .order("desc")
          .first();
        return {
          id: source._id,
          autorite: source.authority,
          visibilite: source.visibility,
          statut: source.status,
          localisateur: source.canonicalLocator,
          derniereVersion: derniere?.version ?? null,
        };
      }),
    );
  },
});

// @reflete language/fastPath:listApprovedPhrases
export const corpus = internalQuery({
  args: {
    language: v.string(),
    contient: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, CAP_LISTE);
    const heads = await ctx.db
      .query("approvedPhrases")
      .withIndex("by_language_and_intent_and_status", (q) =>
        q.eq("language", args.language),
      )
      .take(CAP_LISTE * 5);

    const recherche = args.contient?.toLowerCase();
    const resultats = [];
    for (const head of heads) {
      if (resultats.length >= limit) break;
      const version = await ctx.db
        .query("approvedPhraseVersions")
        .withIndex("by_phraseId_and_version", (q) => q.eq("phraseId", head._id))
        .order("desc")
        .first();
      if (!version) continue;
      if (recherche && !version.text.toLowerCase().includes(recherche)) continue;
      resultats.push({
        cle: head.normalizedKey,
        intention: head.intent,
        statut: head.status,
        version: version.version,
        texte: version.text,
      });
    }
    return resultats;
  },
});

// @reflete conversations/queries:getConversationContext
export const conversation = internalQuery({
  args: { contextId: v.id("conversationContexts") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.contextId);
    if (!found) return null;
    // Metadonnees seulement : le contenu des messages n'est jamais expose a un
    // outil de diagnostic.
    return {
      id: found._id,
      organisation: found.organizationId,
      canal: found.channel,
      langue: found.preferredLanguage,
      statut: found.status,
      alerteDOrigine: found.originAlertId ?? null,
      derniereActivite: found.lastActivityAt,
    };
  },
});
