import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RISQUES } from "../registry/risk.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const CONVEX = path.resolve(ICI, "../../convex");

/* §107 / §67 — parité d'autorisation.
 *
 * La Console, la CLI et le MCP ne réimplémentent pas les règles : ils passent
 * tous par le même noyau. Encore faut-il qu'aucune fonction publique ne
 * contourne ce noyau. Une seule qui l'oublierait suffirait à ouvrir une porte
 * dérobée, et cette porte serait invisible : la fonction marcherait très bien.
 *
 * Ce test lit le code plutôt que de faire confiance à la relecture.
 */

function fichiersTs(racine) {
  const out = [];
  for (const entree of readdirSync(racine)) {
    const complet = path.join(racine, entree);
    if (statSync(complet).isDirectory()) {
      if (entree === "_generated") continue;
      out.push(...fichiersTs(complet));
    } else if (entree.endsWith(".ts") && !entree.endsWith(".test.ts")) {
      out.push(complet);
    }
  }
  return out;
}

/**
 * Fonctions PUBLIQUES (query/mutation/action) et le corps de chacune.
 *
 * Le decoupage s'arrete au prochain `export const`, quel qu'il soit : sinon une
 * fonction interne declaree juste apres serait absorbee dans le corps de la
 * precedente, et le test analyserait le mauvais code.
 */
// Retire commentaires de ligne, de bloc, et contenu des littéraux de chaîne
// avant analyse. Sinon un `authorize(` commenté pour déboguer, ou une capacité
// citée dans un message, satisfait les regex de présence : une fonction sans
// autorisation réelle passerait le test.
function sansCommentaires(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

function fonctionsPubliques() {
  const trouvees = [];
  for (const fichier of fichiersTs(CONVEX)) {
    const source = readFileSync(fichier, "utf8");
    const module = path
      .relative(CONVEX, fichier)
      .replace(/\\/g, "/")
      .replace(/\.ts$/, "");
    const tous = [...source.matchAll(/export const (\w+)\s*=\s*(\w+)\(/g)];
    tous.forEach((m, i) => {
      if (!["query", "mutation", "action"].includes(m[2])) return;
      const fin = i + 1 < tous.length ? tous[i + 1].index : source.length;
      const corps = sansCommentaires(source.slice(m.index, fin));
      const debutHandler = corps.indexOf("handler:");
      trouvees.push({
        cle: `${module}:${m[1]}`,
        genre: m[2],
        corps,
        // Zone des arguments seule : y chercher un nom suffit, alors que le
        // chercher dans tout le corps confondrait `args.organizationId` avec
        // `auth.organizationId`, qui dit exactement le contraire.
        args: debutHandler > 0 ? corps.slice(0, debutHandler) : "",
      });
    });
  }
  return trouvees;
}

const PUBLIQUES = fonctionsPubliques();

describe("couverture de l'autorisation", () => {
  it("recense des fonctions publiques", () => {
    // Garde-fou du test lui-même : un analyseur qui ne trouve rien passerait
    // toutes les assertions suivantes sans rien vérifier.
    expect(PUBLIQUES.length).toBeGreaterThan(40);
  });

  it("fait passer chaque fonction publique par le noyau d'autorisation", () => {
    // Une action n'a pas d'accès direct à la base : elle appelle le noyau par
    // `requireCapability`. C'est la même décision, prise au même endroit.
    const contournements = PUBLIQUES.filter(
      (fn) =>
        !/\bauthorize(Mutation|Resource)?\s*\(/.test(fn.corps) &&
        !/requireCapability/.test(fn.corps),
    ).map((fn) => fn.cle);
    expect(contournements).toEqual([]);
  });

  it("exige une capacité nommée, jamais un contrôle de rôle en dur", () => {
    // §20 : « ne cache pas simplement les boutons ». Un `role === "admin"` en dur
    // contournerait la matrice de permissions sans que personne ne le voie.
    const enDur = PUBLIQUES.filter((fn) =>
      /role\s*===\s*["'](admin|owner)["']/.test(fn.corps),
    ).map((fn) => fn.cle);
    expect(enDur).toEqual([]);

    const sansCapacite = PUBLIQUES.filter(
      (fn) => !/CAPABILITIES\.\w+/.test(fn.corps),
    ).map((fn) => fn.cle);
    expect(sansCapacite).toEqual([]);
  });

  it("classe en risque toute fonction publique", () => {
    const nonClassees = PUBLIQUES.filter((fn) => !RISQUES[fn.cle]).map((fn) => fn.cle);
    expect(nonClassees).toEqual([]);
  });

  it("n'autorise une écriture que par une mutation ou une action", () => {
    // Une query qui écrit serait refusée par Convex, mais une écriture classée
    // par erreur comme lecture tromperait la politique de l'agent, qui n'accorde
    // le MCP qu'aux fonctions READ.
    const incoherentes = PUBLIQUES.filter(
      (fn) => fn.genre === "query" && RISQUES[fn.cle] !== "READ",
    ).map((fn) => fn.cle);
    expect(incoherentes).toEqual([]);
  });

  it("dérive l'organisation de la session, jamais d'un argument client", () => {
    // Accepter un organizationId d'un client permettrait de lire le tenant du
    // voisin. Les fonctions qui en acceptent un doivent le faire passer par
    // scopeOrganization, qui l'ignore pour qui n'est pas opérateur plateforme.
    // Deux gardes acceptables : scopeOrganization, qui ignore l'argument pour
    // qui n'est pas opérateur de plateforme, ou l'exigence de platformManage,
    // qui réserve l'opération à l'opérateur de plateforme.
    const suspectes = PUBLIQUES.filter(
      (fn) =>
        /\borganizationId:\s*v\./.test(fn.args) &&
        !/scopeOrganization\s*\(/.test(fn.corps) &&
        !/CAPABILITIES\.platformManage/.test(fn.corps),
    ).map((fn) => fn.cle);
    expect(suspectes).toEqual([]);
  });
});
