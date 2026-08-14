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

export default http;
