import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OUTILS, DEPLOIEMENTS, DEPLOIEMENT_PAR_DEFAUT } from "../shared/client.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "../..");

/**
 * Ressources MCP (§61) — ce qu'un agent doit lire AVANT d'agir.
 *
 * Un agent qui ne connaît ni les capacités, ni la politique de risque, ni les
 * procédures d'incident finit par inventer une action plausible. Ces ressources
 * lui donnent le cadre : elles sont documentaires, jamais des données métier, et
 * ne contiennent donc aucun secret ni aucune donnée personnelle.
 */

const documents = [
  {
    uri: "wouri://capabilities",
    name: "Capacités et matrice de parité",
    description:
      "Liste canonique des fonctions publiques, leur capacité requise, leur classe de risque et leur exposition Console/CLI/MCP.",
    fichier: "docs/wouri-control-plane/parity-matrix.md",
  },
  {
    uri: "wouri://permissions",
    name: "Matrice des permissions",
    description: "Capacités par préréglage de rôle, et périmètres applicables.",
    fichier: "docs/convex-permissions-matrix.md",
  },
  {
    uri: "wouri://architecture",
    name: "Architecture du socle Convex",
    description: "Domaines, schéma, autorisation, provenance et observabilité.",
    fichier: "docs/convex-architecture.md",
  },
  {
    uri: "wouri://runbooks",
    name: "Runbook d'exploitation",
    description:
      "Déploiement, variables d'environnement, tests de fumée et règles de sécurité.",
    fichier: "docs/convex-runbook.md",
  },
];

/** Politique lisible par l'agent, générée depuis la surface réelle. */
function politique() {
  return [
    "# Politique d'accès de l'agent WOURI",
    "",
    "Ce serveur est en LECTURE SEULE. Il n'expose aucune mutation, et le client",
    "partagé refuse en code tout appel hors du préfixe `diagnostics/readonly`.",
    "",
    "## Ce que l'agent ne peut pas faire",
    "",
    "Publier une alerte, écrire un message à un agriculteur, modifier un",
    "consentement, activer une version de prompt ou de modèle, basculer un",
    "drapeau, suspendre une organisation, lire un secret, exporter des données",
    "personnelles. Ces opérations existent, mais passent par la Console avec une",
    "confirmation humaine explicite.",
    "",
    "## Déploiements",
    "",
    `Valeurs acceptées : ${Object.keys(DEPLOIEMENTS).join(", ")}. Défaut : ${DEPLOIEMENT_PAR_DEFAUT}.`,
    "Rien ne vise un environnement supérieur par omission.",
    "",
    "## Outils disponibles",
    "",
    ...Object.entries(OUTILS).map(([nom, outil]) => `- \`wouri_${nom}\` — ${outil.description}`),
    "",
    "## Données jamais exposées",
    "",
    "Contenu des messages, numéros de téléphone, secrets d'intégration, et le",
    "raisonnement interne du modèle. Une trace expose son CHEMIN d'exécution,",
    "pas la pensée du modèle.",
    "",
  ].join("\n");
}

export function listerRessources() {
  return [
    {
      uri: "wouri://policy",
      name: "Politique d'accès de l'agent",
      description:
        "Ce que l'agent peut et ne peut pas faire, et sur quel déploiement. À lire en premier.",
      mimeType: "text/markdown",
    },
    ...documents
      .filter((doc) => existsSync(path.join(RACINE, doc.fichier)))
      .map(({ uri, name, description }) => ({
        uri,
        name,
        description,
        mimeType: "text/markdown",
      })),
  ];
}

export function lireRessource(uri) {
  if (uri === "wouri://policy") {
    return { uri, mimeType: "text/markdown", text: politique() };
  }
  const doc = documents.find((candidat) => candidat.uri === uri);
  if (!doc) return null;
  const chemin = path.join(RACINE, doc.fichier);
  if (!existsSync(chemin)) return null;
  return { uri, mimeType: "text/markdown", text: readFileSync(chemin, "utf8") };
}
