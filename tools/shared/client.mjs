import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

// On invoque le point d'entree Node de la CLI Convex plutot que le binaire npx.
// Deux raisons : sous Windows, un `.cmd` ne peut pas etre lance sans shell, et
// avec un shell les guillemets du JSON d'arguments sont manges.
const require_ = createRequire(import.meta.url);
const CONVEX_CLI = path.join(
  path.dirname(require_.resolve("convex/package.json")),
  "bin",
  "main.js",
);

/**
 * Client partage par la CLI et le serveur MCP.
 *
 * Il delegue a `npx convex run`, qui porte deja l'authentification par cle de
 * deploiement. Aucun jeton n'est donc manipule ici, et aucune voie
 * d'authentification parallele n'est introduite.
 *
 * Politique DEV-04, appliquee ici et pas seulement documentee :
 * - seules les fonctions du prefixe `diagnostics/readonly` sont appelables ;
 * - toutes sont des requetes, donc aucune ecriture possible ;
 * - la cible par defaut est le staging, la production doit etre demandee
 *   explicitement et reste en lecture seule.
 */

const PREFIXE_AUTORISE = "diagnostics/readonly:";

export class DiagnosticError extends Error {}

export async function appeler(fonction, args = {}, options = {}) {
  if (!fonction.startsWith(PREFIXE_AUTORISE)) {
    throw new DiagnosticError(
      `Fonction refusee : ${fonction}. Seul le prefixe ${PREFIXE_AUTORISE} est autorise (lecture seule).`,
    );
  }

  const cible = options.cible ?? process.env.WOURI_TARGET ?? "prod";
  const arguments_ = [CONVEX_CLI, "run", "--" + cible, fonction, JSON.stringify(args)];

  return new Promise((resolve, reject) => {
    const enfant = spawn(process.execPath, arguments_, {
      cwd: options.cwd ?? process.cwd(),
      shell: false,
    });
    let sortie = "";
    let erreur = "";
    enfant.stdout.on("data", (bloc) => (sortie += bloc));
    enfant.stderr.on("data", (bloc) => (erreur += bloc));
    enfant.on("error", (cause) => reject(new DiagnosticError(String(cause))));
    enfant.on("close", (code) => {
      if (code !== 0) {
        reject(new DiagnosticError(erreur.trim() || `convex run a echoue (code ${code})`));
        return;
      }
      try {
        resolve(JSON.parse(sortie.trim() || "null"));
      } catch {
        // Certaines reponses ne sont pas du JSON strict : on rend le texte brut.
        resolve(sortie.trim());
      }
    });
  });
}

/** Surface exposee, identique pour la CLI et le MCP. */
export const OUTILS = {
  health: {
    fonction: "diagnostics/readonly:health",
    description: "État de la plateforme : organisations, traces, erreurs, abstentions.",
    parametres: {},
  },
  traces: {
    fonction: "diagnostics/readonly:traces",
    description: "Exécutions récentes, filtrables par statut.",
    parametres: {
      resultStatus: "running | succeeded | abstained | failed (optionnel)",
      limit: "nombre maximum de lignes (optionnel)",
    },
  },
  trace: {
    fonction: "diagnostics/readonly:trace",
    description: "Détail d'une exécution : étapes, outils, versions, durées.",
    parametres: { traceId: "identifiant de la trace (requis)" },
  },
  errors: {
    fonction: "diagnostics/readonly:errors",
    description: "Erreurs signalées, filtrables par type de la taxonomie.",
    parametres: { errorType: "type d'erreur (optionnel)", limit: "optionnel" },
  },
  sources: {
    fonction: "diagnostics/readonly:sources",
    description: "Sources de connaissance et leur dernière version.",
    parametres: { limit: "optionnel" },
  },
  corpus: {
    fonction: "diagnostics/readonly:corpus",
    description: "Phrases approuvées du corpus, recherche textuelle simple.",
    parametres: {
      language: "code de langue, par exemple dyu (requis)",
      contient: "texte recherché (optionnel)",
      limit: "optionnel",
    },
  },
  conversation: {
    fonction: "diagnostics/readonly:conversation",
    description:
      "Métadonnées d'une conversation. Le contenu des messages n'est jamais exposé.",
    parametres: { contextId: "identifiant du contexte (requis)" },
  },
};
