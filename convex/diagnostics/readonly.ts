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
    // order("desc") est obligatoire : l'ordre par défaut de Convex est croissant
    // sur _creationTime, donc sans lui `take` renvoie les 100 traces les plus
    // ANCIENNES. `wouri doctor` affichait alors des chiffres figés sur le premier
    // jour d'usage, masquant un incident en cours.
    const [organisations, traces, erreurs] = await Promise.all([
      ctx.db.query("organizationProfiles").take(CAP_LISTE),
      ctx.db.query("executionTraces").order("desc").take(CAP_LISTE),
      ctx.db.query("errorReports").order("desc").take(CAP_LISTE),
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

// @reflete organizations/queries:listOrganizations
export const organizations = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, CAP_LISTE);
    const rows = await ctx.db.query("organizationProfiles").take(limit);
    return rows.map((org) => ({
      id: org.organizationId,
      nom: org.legalName ?? null,
      type: org.kind,
      statut: org.status,
    }));
  },
});

// @reflete farmers/queries:getFarmerProfile
export const farmer = internalQuery({
  args: { farmerId: v.id("farmers") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.farmerId);
    if (!found) return null;
    const profile = await ctx.db
      .query("farmerProfiles")
      .withIndex("by_farmerId", (q) => q.eq("farmerId", found._id))
      .unique();
    const consent = await ctx.db
      .query("farmerConsents")
      .withIndex("by_farmerId_and_purpose_and_recordedAt", (q) =>
        q.eq("farmerId", found._id).eq("purpose", "whatsapp_alerts"),
      )
      .order("desc")
      .first();
    // Metadonnees seulement : ni numero, ni contenu de message. L'identifiant
    // externe est un hachage, il ne revele pas la personne.
    return {
      id: found._id,
      organisation: found.organizationId,
      statut: found.status,
      langue: profile?.preferredLanguage ?? null,
      pays: profile?.countryCode ?? null,
      consentementAlertes: consent?.state ?? "aucun",
      consentementDepuis: consent?.recordedAt ?? null,
    };
  },
});

// @reflete alerts/queries:getAlert
export const alert = internalQuery({
  args: { alertId: v.id("alerts") },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.alertId);
    if (!found) return null;
    const rules = await ctx.db
      .query("alertAudienceRules")
      .withIndex("by_alertId", (q) => q.eq("alertId", found._id))
      .take(CAP_LISTE);
    const deliveries = await ctx.db
      .query("alertDeliveries")
      .withIndex("by_alertId_and_state", (q) => q.eq("alertId", found._id))
      .take(10000);
    const etats: Record<string, number> = {};
    for (const delivery of deliveries) {
      etats[delivery.state] = (etats[delivery.state] ?? 0) + 1;
    }
    return {
      id: found._id,
      organisation: found.organizationId,
      statut: found.status,
      message: found.message,
      sourcee: found.sourceVersionId !== undefined,
      ciblage: rules.map((rule) => ({ type: rule.kind, valeur: rule.targetKey })),
      livraisons: { total: deliveries.length, etats },
    };
  },
});

// @reflete aiops/auditread:listAuditLogs
export const audit = internalQuery({
  args: {
    action: v.optional(v.string()),
    organizationId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, CAP_LISTE);
    // Trois cas distincts, alignés sur listAuditLogs. Dès qu'une organisation est
    // fournie, on passe par SON index et l'action ne fait que restreindre : filtrer
    // l'action APRÈS troncature renverrait zéro si les dernières entrées d'action
    // sont celles d'autres organisations, alors que des entrées org+action plus
    // anciennes existent. Sans organisation mais avec action : index action. Sans
    // filtre : toutes les entrées récentes (by_createdAt), pas les seules sans org.
    let rows;
    if (args.organizationId) {
      const org = args.organizationId;
      const parOrg = await ctx.db
        .query("auditLogs")
        .withIndex("by_organizationId_and_createdAt", (q) =>
          q.eq("organizationId", org),
        )
        .order("desc")
        .take(limit);
      rows = args.action
        ? parOrg.filter((row) => row.action === args.action)
        : parOrg;
    } else if (args.action) {
      rows = await ctx.db
        .query("auditLogs")
        .withIndex("by_action_and_createdAt", (q) => q.eq("action", args.action!))
        .order("desc")
        .take(limit);
    } else {
      rows = await ctx.db
        .query("auditLogs")
        .withIndex("by_createdAt")
        .order("desc")
        .take(limit);
    }
    return rows.map((row) => ({
      id: row._id,
      action: row.action,
      ressource: row.resourceType,
      organisation: row.organizationId ?? null,
      auteur: row.actorMemberId ?? row.actorSubject,
      creeA: row.createdAt,
    }));
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
