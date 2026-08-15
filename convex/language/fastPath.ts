import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { authorize, authorizeMutation, CAPABILITIES } from "../authorization";
import { assertPlatformOrganization } from "../aiops/shared";
import { recordAudit } from "../lib/audit";
import { resolveAuditActor } from "../lib/actor";
import { WouriError, ERROR_TYPES } from "../lib/errors";

// LNG-04 / AI-03 / G09 — gouvernance des phrases validées du Fast Path.
//
// Convex détient la source de vérité : qui a validé quoi, quand, dans quelle
// version. L'index de service qui répond en millisecondes (pgvector côté
// calcul) en est une PROJECTION reconstructible : le supprimer ne perd rien,
// il se reprojette depuis ces tables. Voir ADR-0025.

// Promeut une correction validée en phrase approuvée du Fast Path. Une nouvelle
// version est toujours ajoutée : la précédente n'est jamais écrasée.
export const promoteToApprovedPhrase = mutation({
  args: {
    feedbackId: v.id("linguisticFeedback"),
    intent: v.string(),
    normalizedKey: v.string(),
    text: v.string(),
    culture: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await authorizeMutation(ctx, {
      permission: CAPABILITIES.linguisticValidate,
    });
    // Le corpus est une propriété d'ADC : la langue validée est un actif de la
    // plateforme, servi à toutes les organisations. Seule l'organisation
    // plateforme valide, jamais une coopérative cliente. Voir ADR-0025.
    await assertPlatformOrganization(ctx, auth);
    const feedback = await ctx.db.get(args.feedbackId);
    if (!feedback || feedback.organizationId !== auth.organizationId) {
      throw new WouriError(ERROR_TYPES.PERMISSION, "Feedback not accessible");
    }
    if (feedback.status !== "validated") {
      throw new WouriError(
        ERROR_TYPES.PERMISSION,
        "Only a validated feedback can be promoted",
      );
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("approvedPhrases")
      .withIndex("by_organizationId_and_language_and_normalizedKey", (q) =>
        q
          .eq("organizationId", auth.organizationId)
          .eq("language", feedback.language)
          .eq("normalizedKey", args.normalizedKey),
      )
      .unique();

    const phraseId =
      existing?._id ??
      (await ctx.db.insert("approvedPhrases", {
        organizationId: auth.organizationId,
        language: feedback.language,
        intent: args.intent,
        culture: args.culture,
        normalizedKey: args.normalizedKey,
        status: "approved",
      }));
    if (existing) {
      await ctx.db.patch(existing._id, {
        intent: args.intent,
        culture: args.culture,
        status: "approved",
      });
    }

    const last = await ctx.db
      .query("approvedPhraseVersions")
      .withIndex("by_phraseId_and_version", (q) => q.eq("phraseId", phraseId))
      .order("desc")
      .first();
    const version = (last?.version ?? 0) + 1;
    const versionId = await ctx.db.insert("approvedPhraseVersions", {
      phraseId,
      version,
      text: args.text,
      reviewerMemberId: auth.memberId,
      approvedAt: now,
    });

    await recordAudit(
      ctx,
      {
        organizationId: auth.organizationId,
        ...(await resolveAuditActor(ctx, auth)),
        action: "linguistic.fastPath.promote",
        resourceType: "approvedPhraseVersions",
        resourceId: versionId,
        after: { phraseId, version, intent: args.intent },
      },
      now,
    );
    return { phraseId, version };
  },
});

// Source de la projection vers l'index de service : les phrases approuvées d'une
// langue, avec le texte de leur dernière version. C'est ce que le calcul lit
// pour reconstruire son index, jamais l'inverse.
export const listApprovedPhrases = query({
  args: {
    language: v.string(),
    intent: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const auth = await authorize(ctx, {
      permission: CAPABILITIES.knowledgeRead,
    });
    const limit = Math.min(args.limit ?? 200, 500);
    const phrases = await ctx.db
      .query("approvedPhrases")
      .withIndex("by_language_and_intent_and_status", (q) =>
        args.intent === undefined
          ? q.eq("language", args.language)
          : q.eq("language", args.language).eq("intent", args.intent),
      )
      .take(limit);

    const visible = phrases.filter(
      (phrase) =>
        phrase.status === "approved" &&
        (phrase.organizationId === undefined ||
          phrase.organizationId === auth.organizationId),
    );

    return Promise.all(
      visible.map(async (phrase) => {
        const head = await ctx.db
          .query("approvedPhraseVersions")
          .withIndex("by_phraseId_and_version", (q) =>
            q.eq("phraseId", phrase._id),
          )
          .order("desc")
          .first();
        return {
          phraseId: phrase._id,
          language: phrase.language,
          intent: phrase.intent,
          culture: phrase.culture,
          normalizedKey: phrase.normalizedKey,
          version: head?.version ?? null,
          text: head?.text ?? null,
        };
      }),
    );
  },
});
