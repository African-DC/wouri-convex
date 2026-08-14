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
 * Il delegue a `convex run`, qui porte deja l'authentification par cle de
 * deploiement. Aucun jeton n'est donc manipule ici, et aucune voie
 * d'authentification parallele n'est introduite.
 *
 * Politique DEV-04, appliquee en code et pas seulement documentee :
 * - seules les fonctions du prefixe `diagnostics/readonly` sont appelables, et
 *   toutes sont des requetes : aucune ecriture n'est possible ;
 * - le deploiement vise est EXPLICITE. Rien ne cible la production par defaut,
 *   conformement au principe qu'un outil d'exploitation ne doit jamais y
 *   toucher par omission.
 */

const PREFIXE_AUTORISE = "diagnostics/readonly:";

/**
 * Deploiements atteignables et drapeaux `convex run` correspondants.
 *
 * Le deploiement de developpement est celui par defaut de la CLI Convex : il ne
 * porte donc aucun drapeau, d'ou le tableau vide. Le drapeau `--prod` designe le
 * deploiement de PRODUCTION DU PROJET Convex, qui heberge aujourd'hui les
 * donnees de staging de WOURI : les deux vocabulaires ne se recouvrent pas, et
 * ce tableau est le seul endroit ou la traduction est faite.
 */
export const DEPLOIEMENTS = {
  dev: [],
  staging: ["--prod"],
};

export const DEPLOIEMENT_PAR_DEFAUT = "dev";

export class DiagnosticError extends Error {}

/**
 * Resout le deploiement demande. `WOURI_TARGET` reste honore, mais uniquement
 * s'il est pose explicitement : l'absence de choix ne peut pas conduire ailleurs
 * que sur le deploiement de developpement.
 */
export function resoudreDeploiement(demande) {
  const nom = demande ?? process.env.WOURI_TARGET ?? DEPLOIEMENT_PAR_DEFAUT;
  const drapeaux = DEPLOIEMENTS[nom];
  if (!drapeaux) {
    throw new DiagnosticError(
      `Deploiement inconnu : ${nom}. Valeurs acceptees : ${Object.keys(DEPLOIEMENTS).join(", ")}.`,
    );
  }
  return { nom, drapeaux };
}

export async function appeler(fonction, args = {}, options = {}) {
  if (!fonction.startsWith(PREFIXE_AUTORISE)) {
    throw new DiagnosticError(
      `Fonction refusee : ${fonction}. Seul le prefixe ${PREFIXE_AUTORISE} est autorise (lecture seule).`,
    );
  }

  const { drapeaux } = resoudreDeploiement(options.deploiement);
  const arguments_ = [CONVEX_CLI, "run", ...drapeaux, fonction, JSON.stringify(args)];

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

/**
 * Surface exposee, identique pour la CLI et le MCP.
 *
 * Un parametre dont la description contient « requis » devient obligatoire dans
 * le schema MCP : une seule declaration sert donc les deux interfaces, elles ne
 * peuvent pas diverger.
 */
export const OUTILS = {
  health: {
    fonction: "diagnostics/readonly:health",
    description: "État de la plateforme : organisations, traces, erreurs, abstentions.",
    parametres: {},
  },
  organizations: {
    fonction: "diagnostics/readonly:organizations",
    description: "Organisations enregistrées, leur type et leur statut.",
    parametres: { limit: "nombre maximum de lignes (optionnel)" },
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
  farmer: {
    fonction: "diagnostics/readonly:farmer",
    description:
      "Métadonnées d'un agriculteur : langue, statut, consentement. Ni numéro ni message.",
    parametres: { farmerId: "identifiant de l'agriculteur (requis)" },
  },
  alert: {
    fonction: "diagnostics/readonly:alert",
    description: "Détail d'une alerte : ciblage, statut et répartition des livraisons.",
    parametres: { alertId: "identifiant de l'alerte (requis)" },
  },
  audit: {
    fonction: "diagnostics/readonly:audit",
    description: "Journal des opérations sensibles, filtrable par action.",
    parametres: {
      action: "action journalisée, par exemple alert.publish (optionnel)",
      organizationId: "organisation ciblée (optionnel)",
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
