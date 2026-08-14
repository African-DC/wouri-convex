#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLASSES, RISQUES } from "./risk.mjs";

/**
 * Génère la Capability Registry et la Parity Matrix du Control Plane WOURI.
 *
 * Le document est produit depuis le code, jamais écrit à la main : une matrice
 * de parité maintenue manuellement ment dès le premier commit suivant. Le
 * générateur échoue si une fonction publique n'est pas classée, de sorte qu'une
 * nouvelle surface ne puisse pas entrer sans décision de risque.
 *
 * Usage : node tools/registry/build.mjs [--check] [--console <chemin>]
 *   --check   n'écrit rien, échoue si le document sur disque est périmé
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "../..");
const CONVEX = path.join(RACINE, "convex");
const SORTIE = path.join(RACINE, "docs/wouri-control-plane/parity-matrix.md");

const args = process.argv.slice(2);
const modeCheck = args.includes("--check");
const cheminConsole = (() => {
  const i = args.indexOf("--console");
  if (i !== -1 && args[i + 1]) return path.resolve(args[i + 1]);
  return path.resolve(RACINE, "../wouri-console/src");
})();

// ── Lecture des capacités déclarées ────────────────────────────────────────
function lireCapacites() {
  const source = readFileSync(path.join(CONVEX, "authz/capabilities.ts"), "utf8");
  const bloc = /export const CAPABILITIES = \{([\s\S]*?)\n\} as const;/.exec(source);
  if (!bloc) throw new Error("Bloc CAPABILITIES introuvable");
  const capacites = {};
  for (const m of bloc[1].matchAll(/(\w+):\s*"([^"]+)"/g)) capacites[m[1]] = m[2];

  const presets = {};
  const blocPresets = /export const ROLE_PRESETS = \{([\s\S]*?)\n\} satisfies/.exec(source);
  if (blocPresets) {
    for (const m of blocPresets[1].matchAll(/(\w+):\s*\[([\s\S]*?)\]/g)) {
      presets[m[1]] = [...m[2].matchAll(/CAPABILITIES\.(\w+)/g)].map((c) => c[1]);
    }
  }
  return { capacites, presets };
}

// ── Recensement des fonctions publiques ────────────────────────────────────
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

function recenserFonctions() {
  const fonctions = [];
  for (const fichier of fichiersTs(CONVEX)) {
    const source = readFileSync(fichier, "utf8");
    const module = path
      .relative(CONVEX, fichier)
      .replace(/\\/g, "/")
      .replace(/\.ts$/, "");
    // On découpe sur les exports pour rattacher chaque authorize() à sa fonction.
    const marqueurs = [...source.matchAll(/export const (\w+) = (query|mutation|action)\(/g)];
    marqueurs.forEach((m, i) => {
      const debut = m.index;
      const fin = i + 1 < marqueurs.length ? marqueurs[i + 1].index : source.length;
      const corps = source.slice(debut, fin);
      const capacite = /CAPABILITIES\.(\w+)/.exec(corps)?.[1];
      fonctions.push({
        cle: `${module}:${m[1]}`,
        module,
        nom: m[1],
        genre: m[2],
        capacite: capacite ?? null,
      });
    });
  }
  return fonctions.sort((a, b) => a.cle.localeCompare(b.cle));
}

// ── Surfaces d'exposition réelles ──────────────────────────────────────────
function surfaceConsole() {
  const atteintes = new Set();
  if (!existsSync(cheminConsole)) return { atteintes, disponible: false };
  const pile = [cheminConsole];
  while (pile.length) {
    const courant = pile.pop();
    for (const entree of readdirSync(courant)) {
      const complet = path.join(courant, entree);
      if (statSync(complet).isDirectory()) {
        if (entree === "node_modules") continue;
        pile.push(complet);
      } else if (/\.(tsx?|jsx?)$/.test(entree)) {
        const source = readFileSync(complet, "utf8");
        for (const m of source.matchAll(/api\.([\w.]+)/g)) {
          const morceaux = m[1].split(".");
          if (morceaux.length < 2) continue;
          const nom = morceaux.pop();
          atteintes.add(`${morceaux.join("/")}:${nom}`);
        }
      }
    }
  }
  return { atteintes, disponible: true };
}

function surfaceOutils() {
  const source = readFileSync(path.join(RACINE, "tools/shared/client.mjs"), "utf8");
  const noms = [...source.matchAll(/fonction:\s*"diagnostics\/readonly:(\w+)"/g)].map((m) => m[1]);
  const readonly = readFileSync(path.join(CONVEX, "diagnostics/readonly.ts"), "utf8");
  // Chaque diagnostic documente la fonction publique qu'il reflète via un
  // commentaire `@reflete <cle>` ; sans lui on ne peut pas prouver la parité.
  const reflets = {};
  const marqueurs = [...readonly.matchAll(/export const (\w+) = internalQuery\(/g)];
  marqueurs.forEach((m, i) => {
    const fin = i + 1 < marqueurs.length ? marqueurs[i + 1].index : readonly.length;
    const corps = readonly.slice(m.index - 400 < 0 ? 0 : m.index - 400, fin);
    reflets[m[1]] = [...corps.matchAll(/@reflete\s+([\w/:]+)/g)].map((r) => r[1]);
  });
  const couvertes = new Set();
  for (const nom of noms) for (const cle of reflets[nom] ?? []) couvertes.add(cle);
  return { outils: noms, couvertes };
}

// ── Génération ─────────────────────────────────────────────────────────────
const { capacites, presets } = lireCapacites();
const fonctions = recenserFonctions();
const { atteintes: console_, disponible: consoleDisponible } = surfaceConsole();
const { outils, couvertes } = surfaceOutils();

const nonClassees = fonctions.filter((f) => !RISQUES[f.cle]);
const sansCapacite = fonctions.filter((f) => !f.capacite);

const marque = (vrai) => (vrai ? "oui" : "—");

const parCapacite = new Map();
for (const f of fonctions) {
  const cap = f.capacite ?? "(aucune)";
  if (!parCapacite.has(cap)) parCapacite.set(cap, []);
  parCapacite.get(cap).push(f);
}

const lignes = [];
lignes.push("# Capability Registry et Parity Matrix");
lignes.push("");
lignes.push(
  "Document **généré** par `node tools/registry/build.mjs`. Ne pas le modifier à",
  "la main : il serait faux au premier commit suivant. Le générateur échoue si",
  "une fonction publique n'est pas classée en risque, pour qu'aucune surface",
  "n'entre sans décision explicite.",
);
lignes.push("");
lignes.push(`Fonctions publiques recensées : **${fonctions.length}**. Capacités déclarées : **${Object.keys(capacites).length}**.`);
lignes.push("");

lignes.push("## Classes de risque et politique d'exposition");
lignes.push("");
lignes.push("| Classe | Console | CLI | MCP | Audit | Dry-run | Confirmation |");
lignes.push("| --- | --- | --- | --- | --- | --- | --- |");
for (const [nom, p] of Object.entries(CLASSES)) {
  lignes.push(
    `| ${nom} | ${p.console} | ${p.cli} | ${p.mcp} | ${marque(p.audit)} | ${marque(p.dryRun)} | ${marque(p.confirmation)} |`,
  );
}
lignes.push("");

lignes.push("## Capacités et rôles");
lignes.push("");
lignes.push("| Capacité | Fonctions | Préréglages qui la portent |");
lignes.push("| --- | --- | --- |");
for (const [cle, valeur] of Object.entries(capacites)) {
  const fns = parCapacite.get(cle) ?? [];
  const roles = Object.entries(presets)
    .filter(([, caps]) => caps.includes(cle))
    .map(([role]) => role);
  lignes.push(
    `| \`${valeur}\` | ${fns.length} | ${roles.length ? roles.join(", ") : "aucun"} |`,
  );
}
lignes.push("");

lignes.push("## Matrice de parité");
lignes.push("");
lignes.push(
  consoleDisponible
    ? "Colonne Console renseignée depuis le code du dépôt `wouri-console`."
    : "> Dépôt `wouri-console` introuvable : la colonne Console n'a pas pu être vérifiée.",
);
lignes.push("");
lignes.push("| Fonction | Type | Capacité | Risque | Console | CLI/MCP |");
lignes.push("| --- | --- | --- | --- | --- | --- |");
for (const f of fonctions) {
  const risque = RISQUES[f.cle] ?? "**NON CLASSÉE**";
  lignes.push(
    `| \`${f.cle}\` | ${f.genre} | ${f.capacite ? `\`${capacites[f.capacite] ?? f.capacite}\`` : "**aucune**"} | ${risque} | ${marque(console_.has(f.cle))} | ${marque(couvertes.has(f.cle))} |`,
  );
}
lignes.push("");

const orphelines = fonctions.filter((f) => !console_.has(f.cle) && !couvertes.has(f.cle));
lignes.push("## Fonctions orphelines");
lignes.push("");
lignes.push(
  "Exposées par le backend, atteignables depuis aucune interface. Chacune est",
  "soit un trou du Control Plane, soit une surface à retirer.",
);
lignes.push("");
if (orphelines.length === 0) {
  lignes.push("Aucune.");
} else {
  lignes.push(`**${orphelines.length}** sur ${fonctions.length}.`);
  lignes.push("");
  lignes.push("| Fonction | Risque |");
  lignes.push("| --- | --- |");
  for (const f of orphelines) lignes.push(`| \`${f.cle}\` | ${RISQUES[f.cle] ?? "NON CLASSÉE"} |`);
}
lignes.push("");

lignes.push("## Surface de diagnostic (CLI et MCP)");
lignes.push("");
lignes.push(
  "La CLI et le serveur MCP partagent une seule surface, en lecture seule, dont",
  "le préfixe est vérifié en code et non seulement documenté (DEV-04).",
);
lignes.push("");
lignes.push(`Outils exposés : ${outils.map((o) => `\`${o}\``).join(", ")}.`);
lignes.push("");

const document = lignes.join("\n") + "\n";

if (nonClassees.length > 0) {
  console.error("Fonctions publiques non classées en risque :");
  for (const f of nonClassees) console.error(`  ${f.cle}`);
  console.error("Ajoutez-les à tools/registry/risk.mjs.");
  process.exit(1);
}
if (sansCapacite.length > 0) {
  console.error("Fonctions publiques sans capacité requise :");
  for (const f of sansCapacite) console.error(`  ${f.cle}`);
  process.exit(1);
}

if (modeCheck) {
  const actuel = existsSync(SORTIE) ? readFileSync(SORTIE, "utf8") : "";
  if (actuel !== document) {
    console.error(`${SORTIE} est périmé. Relancez node tools/registry/build.mjs.`);
    process.exit(1);
  }
  console.log("Matrice de parité à jour.");
  process.exit(0);
}

writeFileSync(SORTIE, document);
console.log(`Écrit ${path.relative(RACINE, SORTIE)}`);
console.log(`  ${fonctions.length} fonctions, ${orphelines.length} orphelines`);
