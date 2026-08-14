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

  it("n'expose aucune fonction sensible ou destructrice", () => {
    const interdites = Object.entries(RISQUES)
      .filter(([, classe]) => classe !== "READ")
      .map(([cle]) => cle);
    const exposees = Object.values(OUTILS).map((outil) => outil.fonction);
    for (const cle of interdites) {
      expect(exposees).not.toContain(cle);
    }
  });
});
