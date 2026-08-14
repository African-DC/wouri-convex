import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTILS,
  DEPLOIEMENT_PAR_DEFAUT,
  DEPLOIEMENTS,
  DiagnosticError,
  appeler,
  resoudreDeploiement,
} from "./client.mjs";
import { RISQUES } from "../registry/risk.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "../..");

/* DEV-04 / §65-66 / §104-106 — la politique de l'agent est vérifiée, pas
   seulement écrite. Une politique qu'aucun test ne défend se dégrade au premier
   ajout d'outil : quelqu'un expose une mutation « juste pour dépanner » et
   personne ne le remarque. */

describe("politique de l'outillage de diagnostic", () => {
  it("n'expose que des fonctions du préfixe de lecture seule", () => {
    for (const [nom, outil] of Object.entries(OUTILS)) {
      expect(outil.fonction, `outil ${nom}`).toMatch(/^diagnostics\/readonly:/);
    }
  });

  it("refuse en code tout appel hors de ce préfixe", async () => {
    await expect(appeler("alerts/mutations:publishAlert", {})).rejects.toBeInstanceOf(
      DiagnosticError,
    );
    await expect(appeler("farmers/mutations:withdrawConsent", {})).rejects.toBeInstanceOf(
      DiagnosticError,
    );
  });

  it("ne vise aucun déploiement supérieur par défaut", () => {
    // Sans cette ligne le test passe par accident : la CI ne pose pas la
    // variable, mais le poste d un operateur qui travaille sur staging si.
    delete process.env.WOURI_TARGET;
    expect(DEPLOIEMENT_PAR_DEFAUT).toBe("dev");
    expect(resoudreDeploiement(undefined).nom).toBe("dev");
    expect(() => resoudreDeploiement("production-inconnue")).toThrow(DiagnosticError);
  });

  it("traduit chaque déploiement nommé en drapeaux Convex", () => {
    // Le vocabulaire WOURI (dev, staging) et celui de Convex (défaut, --prod) ne
    // se recouvrent pas : la traduction doit rester à un seul endroit.
    for (const drapeaux of Object.values(DEPLOIEMENTS)) {
      expect(Array.isArray(drapeaux)).toBe(true);
      for (const drapeau of drapeaux) expect(drapeau).toMatch(/^--/);
    }
    expect(DEPLOIEMENTS.dev).toEqual([]);
  });

  it("ne reflète que des fonctions classées READ", () => {
    // Chaque diagnostic déclare la fonction publique qu'il reflète. Refléter une
    // écriture reviendrait à contourner la Console par un chemin non confirmé.
    const source = readFileSync(
      path.join(RACINE, "convex/diagnostics/readonly.ts"),
      "utf8",
    );
    const reflets = [...source.matchAll(/@reflete\s+([\w/:]+)/g)].map((m) => m[1]);
    expect(reflets.length).toBeGreaterThan(0);
    for (const cle of reflets) {
      expect(RISQUES[cle], `classe de risque de ${cle}`).toBe("READ");
    }
  });

  // Le test précédent comparait des clés `diagnostics/readonly:*` à des clés
  // `alerts/mutations:*` : deux ensembles disjoints par construction, donc une
  // assertion qui ne pouvait pas échouer. Les trois suivants vérifient
  // réellement la propriété.

  it("n'expose que des internalQuery, jamais une mutation", () => {
    // La garantie de lecture seule ne doit pas reposer sur le nom du fichier.
    const source = readFileSync(
      path.join(RACINE, "convex/diagnostics/readonly.ts"),
      "utf8",
    );
    const declarations = [...source.matchAll(/export const (\w+)\s*=\s*(\w+)\(/g)];
    expect(declarations.length).toBeGreaterThan(0);
    for (const [, nom, genre] of declarations) {
      expect(genre, `diagnostics/readonly:${nom}`).toBe("internalQuery");
    }
  });

  it("annote chaque outil exposé de la fonction qu'il reflète", () => {
    // Sans cette assertion, une fonction non annotée était invisible : le test
    // des annotations n'itérait que sur celles qui existaient déjà.
    const source = readFileSync(
      path.join(RACINE, "convex/diagnostics/readonly.ts"),
      "utf8",
    );
    const declarations = [...source.matchAll(/export const (\w+)\s*=\s*internalQuery\(/g)];
    const annotes = new Set();
    declarations.forEach((m, i) => {
      const debut = i === 0 ? 0 : declarations[i - 1].index;
      if (/@reflete\s+[\w/:]+/.test(source.slice(debut, m.index))) annotes.add(m[1]);
    });
    for (const nom of Object.keys(OUTILS)) {
      expect(annotes.has(nom), `outil ${nom} sans @reflete`).toBe(true);
    }
  });

  it("ne reflète que des fonctions classées READ, outil par outil", () => {
    const source = readFileSync(
      path.join(RACINE, "convex/diagnostics/readonly.ts"),
      "utf8",
    );
    for (const [nom, outil] of Object.entries(OUTILS)) {
      const diagnostic = outil.fonction.replace("diagnostics/readonly:", "");
      const bloc = new RegExp(
        `@reflete([^\\n]*)\\n(?:[^\\n]*\\n)?export const ${diagnostic}\\s*=`,
      ).exec(source);
      expect(bloc, `annotation de ${nom}`).not.toBeNull();
      // Une ligne peut porter plusieurs annotations : on retire le marqueur
      // lui-même pour ne garder que les clés de fonction.
      const cles = bloc[1]
        .trim()
        .split(/\s+/)
        .filter((jeton) => jeton && !jeton.startsWith("@"));
      expect(cles.length, `${nom} sans clé reflétée`).toBeGreaterThan(0);
      for (const cle of cles) {
        expect(RISQUES[cle], `${nom} reflète ${cle}`).toBe("READ");
      }
    }
  });
});
