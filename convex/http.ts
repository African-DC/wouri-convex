import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { authComponent, createAuth } from "./auth";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

/* Surfaces machine-à-machine.
 *
 * Ces routes n'ont pas de session utilisateur : elles sont appelées par le
 * moteur de langue et le serveur WhatsApp, qui portent une clé partagée. Elles
 * délèguent donc systématiquement à une fonction interne, et ne font jamais
 * confiance à ce que l'appelant déclare sur lui-même.
 *
 * Règle appliquée partout ici : échec fermé. Une clé absente côté serveur
 * refuse la requête au lieu de l'accepter, sans quoi un déploiement mal
 * configuré ouvrirait la surface au monde entier. */

const runtimeEnvironment = globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

const secretDeploiement = (nom: string): string | undefined =>
  runtimeEnvironment.process?.env?.[nom];

/**
 * Compare deux chaînes sans fuir leur préfixe commun par le temps d'exécution.
 * Le runtime Convex n'expose pas `crypto.timingSafeEqual` : on parcourt donc
 * toute la longueur en accumulant les différences.
 */
function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/** Vérifie une clé partagée portée par un en-tête. Échec fermé. */
function cleValide(requete: Request, enTete: string, variable: string): boolean {
  const attendue = secretDeploiement(variable);
  if (!attendue) return false;
  const fournie = requete.headers.get(enTete);
  if (!fournie) return false;
  return egaliteConstante(fournie, attendue);
}

const refus = (message: string, code = 401) =>
  new Response(JSON.stringify({ error: message }), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });

const json = (charge: unknown, code = 200) =>
  new Response(JSON.stringify(charge), {
    status: code,
    headers: { "Content-Type": "application/json" },
  });

// ADR-0025 — le moteur importe le corpus depuis ici. Il compare `revision` à
// celle qu'il a en base et ne réimporte que si elle a changé.
http.route({
  path: "/corpus/export",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!cleValide(request, "X-Corpus-Key", "CORPUS_EXPORT_KEY")) {
      return refus("unauthorized");
    }
    const corpus = await ctx.runQuery(internal.corpus.export.corpusForEngine, {});
    return json(corpus);
  }),
});

// Chantier 1 — le moteur (via le serveur WhatsApp) émet un événement par tour.
// On en fait une trace, visible dans la Console au même endroit que le reste.
const STATUTS_EVENEMENT = new Set(["succeeded", "abstained", "failed"]);

http.route({
  path: "/ingest/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!cleValide(request, "X-Ingest-Key", "INGEST_KEY")) {
      return refus("unauthorized");
    }
    let corps: unknown;
    try {
      corps = await request.json();
    } catch {
      return refus("invalid_json", 400);
    }
    const e = corps as Record<string, unknown>;
    // Validation stricte : on n'insère jamais un événement mal formé, et un
    // champ absent ne devient pas une chaîne vide.
    if (typeof e.requestId !== "string" || typeof e.channel !== "string") {
      return refus("requestId and channel required", 400);
    }
    if (typeof e.status !== "string" || !STATUTS_EVENEMENT.has(e.status)) {
      return refus("status must be succeeded | abstained | failed", 400);
    }
    const { traceId } = await ctx.runMutation(
      internal.integration.ingest.recordEngineEvent,
      {
        requestId: e.requestId,
        channel: e.channel,
        status: e.status as "succeeded" | "abstained" | "failed",
        ...(typeof e.language === "string" ? { language: e.language } : {}),
        ...(typeof e.intent === "string" ? { intent: e.intent } : {}),
        ...(typeof e.source === "string" ? { source: e.source } : {}),
        ...(typeof e.latencyMs === "number" ? { latencyMs: e.latencyMs } : {}),
        ...(typeof e.errorType === "string" ? { errorType: e.errorType } : {}),
      },
    );
    return json({ traceId });
  }),
});

// Chantier 2 — le serveur WhatsApp confirme le statut d'une livraison. On le
// rapproche par providerMessageId (index déjà en place) et on avance l'état,
// sans jamais régresser une livraison déjà partie.
const ETATS_LIVRAISON = new Set(["sent", "delivered", "read", "replied", "failed"]);

http.route({
  path: "/whatsapp/callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!cleValide(request, "X-Callback-Key", "WHATSAPP_CALLBACK_KEY")) {
      return refus("unauthorized");
    }
    let corps: unknown;
    try {
      corps = await request.json();
    } catch {
      return refus("invalid_json", 400);
    }
    const c = corps as Record<string, unknown>;
    if (typeof c.providerMessageId !== "string") {
      return refus("providerMessageId required", 400);
    }
    if (typeof c.state !== "string" || !ETATS_LIVRAISON.has(c.state)) {
      return refus("state invalid", 400);
    }
    const { deliveryId } = await ctx.runMutation(
      internal.alerts.mutations.recordDeliveryCallback,
      {
        providerMessageId: c.providerMessageId,
        state: c.state as "sent" | "delivered" | "read" | "replied" | "failed",
        ...(typeof c.provider === "string" ? { provider: c.provider } : {}),
      },
    );
    // deliveryId null = aucun message ne correspond. Ce n'est pas une erreur du
    // callback : on le signale pour que l'appelant sache que rien n'a bougé.
    return json({ matched: deliveryId !== null, deliveryId });
  }),
});

// Chantier 2 — diffusion en pull. Le serveur WhatsApp récupère les livraisons à
// envoyer (Convex ne peut pas l'atteindre, il est sur un réseau privé). La
// réponse ne contient jamais de numéro : seulement une référence de contact que
// le serveur, seul détenteur des numéros, résout de son côté.
http.route({
  path: "/alerts/pending",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!cleValide(request, "X-Dispatch-Key", "DISPATCH_KEY")) {
      return refus("unauthorized");
    }
    const livraisons = await ctx.runQuery(
      internal.integration.dispatch.pendingDeliveries,
      {},
    );
    return json({ deliveries: livraisons });
  }),
});

// Le serveur confirme qu'une livraison est partie et fournit l'identifiant du
// message. On le stampe, l'état passe à « sent », et le reste du cycle arrive
// par /whatsapp/callback.
http.route({
  path: "/alerts/dispatched",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!cleValide(request, "X-Dispatch-Key", "DISPATCH_KEY")) {
      return refus("unauthorized");
    }
    let corps: unknown;
    try {
      corps = await request.json();
    } catch {
      return refus("invalid_json", 400);
    }
    const d = corps as Record<string, unknown>;
    if (typeof d.deliveryId !== "string" || typeof d.providerMessageId !== "string") {
      return refus("deliveryId and providerMessageId required", 400);
    }
    // La mutation valide l'identifiant (normalizeId) : un identifiant d'une autre
    // table ou mal formé y est refusé proprement plutôt que de lever.
    const resultat = await ctx.runMutation(
      internal.integration.dispatch.markDispatched,
      { deliveryId: d.deliveryId, providerMessageId: d.providerMessageId },
    );
    // Identifiant mal formé OU introuvable : dans les deux cas la référence ne
    // désigne aucune livraison, on le signale par un 400 plutôt que par un 200
    // silencieux, sinon le serveur croit avoir rattaché un providerMessageId qui
    // n'ira nulle part.
    if (
      !resultat.updated &&
      (resultat.reason === "invalid_id" || resultat.reason === "unknown_delivery")
    ) {
      return refus(`delivery ${resultat.reason}`, 400);
    }
    return json(resultat);
  }),
});

// Le serveur WhatsApp enregistre un agriculteur par sa référence de contact (il
// calcule la contactRef = HMAC du numéro, Convex ne voit jamais le numéro). Même
// clé que le callback : c'est le même serveur. Idempotent.
http.route({
  path: "/whatsapp/farmer",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!cleValide(request, "X-Callback-Key", "WHATSAPP_CALLBACK_KEY")) {
      return refus("unauthorized");
    }
    let corps: unknown;
    try {
      corps = await request.json();
    } catch {
      return refus("invalid_json", 400);
    }
    const f = corps as Record<string, unknown>;
    if (typeof f.organizationId !== "string" || typeof f.contactRef !== "string") {
      return refus("organizationId and contactRef required", 400);
    }
    const resultat = await ctx.runMutation(
      internal.integration.farmers.registerFarmerByContact,
      { organizationId: f.organizationId, contactRef: f.contactRef },
    );
    return json(resultat);
  }),
});

// Chantier 3 — opt-out. Le serveur WhatsApp signale un STOP entrant. On retire le
// consentement à la diffusion pour ce contact. Même clé que le callback : c'est
// le même serveur WhatsApp qui rapporte un événement entrant.
http.route({
  path: "/whatsapp/optout",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!cleValide(request, "X-Callback-Key", "WHATSAPP_CALLBACK_KEY")) {
      return refus("unauthorized");
    }
    let corps: unknown;
    try {
      corps = await request.json();
    } catch {
      return refus("invalid_json", 400);
    }
    const o = corps as Record<string, unknown>;
    if (typeof o.organizationId !== "string" || typeof o.contactRef !== "string") {
      return refus("organizationId and contactRef required", 400);
    }
    const resultat = await ctx.runMutation(internal.integration.optout.recordOptOut, {
      organizationId: o.organizationId,
      contactRef: o.contactRef,
    });
    // Un contact introuvable veut dire que le retrait de consentement n'a PAS eu
    // lieu : c'est un droit légal, on ne le déguise pas en 200. Le serveur doit
    // voir l'échec pour le rejouer avec le bon organizationId ou la bonne
    // référence. already_withdrawn reste un succès (idempotence).
    if (!resultat.applied && resultat.reason === "unknown_contact") {
      return new Response(JSON.stringify(resultat), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return json(resultat);
  }),
});

// Chantier 4 — façade publique de traduction, servie depuis le corpus validé.
//
// Publique par conception : c'est la démo du site. Aucune clé, car le corpus
// approuvé n'est pas secret (il est fait pour être servi aux agriculteurs). On
// borne quand même l'entrée et on autorise CORS pour un appel navigateur direct
// ou via la route serveur du site. Aucune donnée personnelle n'entre ni ne sort.
const enTetesCors = (request: Request) => ({
  "Access-Control-Allow-Origin": request.headers.get("Origin") ?? "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
});

const LONGUEUR_MAX_TRADUCTION = 2000;

http.route({
  path: "/public/translate",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) =>
    new Response(null, { status: 204, headers: enTetesCors(request) }),
  ),
});

http.route({
  path: "/public/translate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const cors = enTetesCors(request);
    let corps: unknown;
    try {
      corps = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }
    const t = corps as Record<string, unknown>;
    if (
      typeof t.source !== "string" ||
      typeof t.target !== "string" ||
      typeof t.text !== "string"
    ) {
      return new Response(
        JSON.stringify({ error: "source, target and text required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } },
      );
    }
    if (t.text.length > LONGUEUR_MAX_TRADUCTION) {
      return new Response(JSON.stringify({ error: "text too long" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }
    // Traduire une langue vers elle-même renverrait un écho du texte approuvé :
    // pas une invention, mais une réponse trompeuse. On la refuse franchement.
    if (t.source === t.target) {
      return new Response(JSON.stringify({ error: "source and target must differ" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...cors },
      });
    }
    const resultat = await ctx.runQuery(internal.public.translate.lookupTranslation, {
      source: t.source,
      target: t.target,
      text: t.text,
    });
    return new Response(JSON.stringify(resultat), {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  }),
});

// Chantier 4 (démo technologique) — proxy vers le VRAI moteur de langue.
//
// Le moteur expose `POST /api/tts/` (language=dioula) qui, en un appel, traduit
// FR->dioula ET rend l'audio en vraie voix MMS-TTS-dioula. Mais : il exige une
// clé `X-API-Key`, sa CORS est coupée en production, et il n'est pas joignable
// par un navigateur. Ce proxy résout les trois : il détient la clé (jamais
// exposée au site), ajoute la CORS, et Convex l'atteint une fois le moteur exposé
// sur un sous-domaine public (à faire côté Issouf).
//
// Tant que ENGINE_URL / ENGINE_API_KEY ne sont pas configurées, le proxy répond
// « moteur indisponible » et le site retombe proprement sur la couche validée.
const LONGUEUR_MAX_MOTEUR = 2000;

http.route({
  path: "/public/engine/speak",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) =>
    new Response(null, { status: 204, headers: enTetesCors(request) }),
  ),
});

http.route({
  path: "/public/engine/speak",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const cors = enTetesCors(request);
    const enJson = (charge: unknown, code = 200) =>
      new Response(JSON.stringify(charge), {
        status: code,
        headers: { "Content-Type": "application/json", ...cors },
      });

    const engineUrl = secretDeploiement("ENGINE_URL");
    const engineKey = secretDeploiement("ENGINE_API_KEY");
    // Non configuré = moteur pas encore exposé. On le dit franchement ; le site
    // bascule sur la couche validée, il ne montre jamais une fausse voix.
    if (!engineUrl || !engineKey) {
      return enJson({ error: "engine_unavailable", reason: "not_configured" }, 503);
    }

    let corps: unknown;
    try {
      corps = await request.json();
    } catch {
      return enJson({ error: "invalid_json" }, 400);
    }
    const b = corps as Record<string, unknown>;
    if (typeof b.text !== "string" || b.text.trim().length === 0) {
      return enJson({ error: "text required" }, 400);
    }
    if (b.text.length > LONGUEUR_MAX_MOTEUR) {
      return enJson({ error: "text too long" }, 400);
    }

    try {
      const reponse = await fetch(`${engineUrl.replace(/\/$/, "")}/api/tts/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": engineKey },
        body: JSON.stringify({ text: b.text, language: "dioula" }),
      });
      if (!reponse.ok) {
        return enJson({ error: "engine_error", status: reponse.status }, 502);
      }
      const data = (await reponse.json()) as {
        text?: string;
        audio_url?: string;
        language?: string;
      };
      // L'audio est servi en chemin relatif (`/static/...`) : on le rend absolu
      // pour que le navigateur le lise directement (une balise <audio> ne subit
      // pas la CORS pour la lecture).
      const audioUrl = data.audio_url
        ? new URL(data.audio_url, engineUrl).toString()
        : null;
      return enJson({
        source: "moteur",
        texte: data.text ?? null,
        audioUrl,
        langue: data.language ?? "dioula",
      });
    } catch {
      // Moteur injoignable : ni erreur avalée, ni fausse réussite.
      return enJson({ error: "engine_unreachable" }, 502);
    }
  }),
});


// Premier compte ADC : la page de connexion lit cet etat avant d afficher
// le formulaire d inscription. Aucune donnee personnelle n est renvoyee.
http.route({
  path: "/public/auth/bootstrap",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const etat = await ctx.runQuery(internal.authBootstrap.needsBootstrap, {});
    return json(etat);
  }),
});

export default http;

