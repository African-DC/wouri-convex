import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { startTrace, appendTraceStep, finishTrace } from "../lib/trace";
import { ALL_ERROR_TYPES, type ErrorType } from "../lib/errors";

// Chantier 1 — le moteur émet un événement par tour de conversation. On en fait
// une trace d'exécution, la même structure que celle du pipeline Convex, pour
// que la Console montre les interactions WhatsApp au même endroit que le reste.
//
// Le moteur n'a pas de session : l'événement n'appartient donc à aucune
// organisation en propre (organizationId reste vide). C'est assumé : ces traces
// sont plateforme, l'opérateur ADC les voit, un tenant ne les voit pas. On ne
// fait jamais confiance à un organizationId que l'appelant déclarerait.

const statutValidator = v.union(
  v.literal("succeeded"),
  v.literal("abstained"),
  v.literal("failed"),
);

const errorTypeValide = (valeur: string | undefined): ErrorType | undefined => {
  if (!valeur) return undefined;
  if ((ALL_ERROR_TYPES as string[]).includes(valeur)) return valeur as ErrorType;
  // Le moteur a émis un code d'erreur qu'on ne connaît pas : on enregistre quand
  // même l'événement, mais on signale le code à ajouter à l'enum plutôt que de
  // l'abandonner en silence.
  console.warn(`[ingest] errorType inconnu ignoré : ${valeur}`);
  return undefined;
};

export const recordEngineEvent = internalMutation({
  args: {
    // Identifiant de corrélation propagé de WhatsApp au moteur. Il ne relie pas
    // à une personne : c'est l'identifiant Baileys du message.
    requestId: v.string(),
    channel: v.string(),
    language: v.optional(v.string()),
    intent: v.optional(v.string()),
    // Source de la réponse : ivr_exact, deepseek_open, etc. Dit si le corpus a
    // répondu ou si le modèle a pris le relais.
    source: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    status: statutValidator,
    errorType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const errorType = errorTypeValide(args.errorType);

    const traceId = await startTrace(
      ctx,
      {
        channel: args.channel,
        ...(args.intent !== undefined ? { intent: args.intent } : {}),
        ...(args.language !== undefined ? { language: args.language } : {}),
      },
      now,
    );

    // Une étape unique : ce que le moteur a fait pour composer la réponse. Le
    // nom porte la source, le détail reste sans donnée personnelle.
    await appendTraceStep(
      ctx,
      traceId,
      {
        kind: "generation",
        name: args.source ?? "engine-answer",
        status: args.status === "failed" ? "error" : "ok",
        ...(args.latencyMs !== undefined ? { latencyMs: args.latencyMs } : {}),
      },
      now,
    );

    await finishTrace(
      ctx,
      traceId,
      {
        resultStatus: args.status,
        ...(args.latencyMs !== undefined ? { latencyMs: args.latencyMs } : {}),
        // requestId conservé comme identifiant externe : c'est le pont vers le
        // journal du serveur, sans jamais stocker le contenu ni le numéro.
        externalTelemetryId: args.requestId,
        ...(errorType ? { errorType } : {}),
      },
      now,
    );

    return { traceId };
  },
});
