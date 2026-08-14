#!/usr/bin/env node
import { appeler, OUTILS, DiagnosticError } from "../shared/client.mjs";

/**
 * CLI WOURI (DEV-02) — diagnostic en lecture seule.
 *
 * Usage :
 *   wouri doctor
 *   wouri health
 *   wouri traces [--statut failed] [--limite 10]
 *   wouri trace <id>
 *   wouri errors [--type ASR_ERROR]
 *   wouri sources
 *   wouri corpus <langue> [--contient cacao]
 *   wouri conversation <id>
 *
 * Cible le staging par defaut. `--cible prod` vise la production, toujours en
 * lecture seule : aucune commande de ce binaire n'ecrit quoi que ce soit.
 */

const args = process.argv.slice(2);
const commande = args[0];

function option(nom, defaut) {
  const index = args.indexOf(`--${nom}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : defaut;
}

function positionnel(index) {
  const libres = args.slice(1).filter((a, i, tous) => {
    if (a.startsWith("--")) return false;
    return !(i > 0 && tous[i - 1]?.startsWith("--"));
  });
  return libres[index];
}

function afficher(valeur) {
  console.log(JSON.stringify(valeur, null, 2));
}

function aide() {
  console.log("\nCLI WOURI — diagnostic en lecture seule\n");
  for (const [nom, outil] of Object.entries(OUTILS)) {
    console.log(`  wouri ${nom.padEnd(14)} ${outil.description}`);
  }
  console.log("  wouri doctor         Vérifie l'accès et affiche l'état de santé.\n");
  console.log("  Options : --cible prod|dev   --limite N\n");
  console.log("  Aucune commande de cet outil ne modifie l'état de la plateforme.\n");
}

const cible = option("cible");
const limite = option("limite");
const limitArg = limite ? { limit: Number(limite) } : {};

try {
  switch (commande) {
    case "doctor": {
      const etat = await appeler(OUTILS.health.fonction, {}, { cible });
      console.log("Accès au déploiement : OK");
      console.log(`Environnement        : ${etat.environnement}`);
      console.log(`Organisations        : ${etat.organisations} (${etat.organisationsActives} actives)`);
      console.log(`Traces récentes      : ${etat.tracesRecentes}`);
      console.log(`Abstentions          : ${etat.abstentions}`);
      console.log(`Échecs               : ${etat.echecs}`);
      if (etat.environnement === "production") {
        console.log("\nAttention : cible de production. Cet outil reste en lecture seule.");
      }
      break;
    }
    case "health":
      afficher(await appeler(OUTILS.health.fonction, {}, { cible }));
      break;
    case "traces": {
      const statut = option("statut");
      afficher(
        await appeler(
          OUTILS.traces.fonction,
          { ...(statut ? { resultStatus: statut } : {}), ...limitArg },
          { cible },
        ),
      );
      break;
    }
    case "trace": {
      const id = positionnel(0);
      if (!id) throw new DiagnosticError("Identifiant de trace manquant.");
      afficher(await appeler(OUTILS.trace.fonction, { traceId: id }, { cible }));
      break;
    }
    case "errors": {
      const type = option("type");
      afficher(
        await appeler(
          OUTILS.errors.fonction,
          { ...(type ? { errorType: type } : {}), ...limitArg },
          { cible },
        ),
      );
      break;
    }
    case "sources":
      afficher(await appeler(OUTILS.sources.fonction, limitArg, { cible }));
      break;
    case "corpus": {
      const langue = positionnel(0);
      if (!langue) throw new DiagnosticError("Langue manquante, par exemple : wouri corpus dyu");
      const contient = option("contient");
      afficher(
        await appeler(
          OUTILS.corpus.fonction,
          { language: langue, ...(contient ? { contient } : {}), ...limitArg },
          { cible },
        ),
      );
      break;
    }
    case "conversation": {
      const id = positionnel(0);
      if (!id) throw new DiagnosticError("Identifiant de conversation manquant.");
      afficher(await appeler(OUTILS.conversation.fonction, { contextId: id }, { cible }));
      break;
    }
    default:
      aide();
      process.exit(commande ? 1 : 0);
  }
} catch (cause) {
  console.error(
    cause instanceof DiagnosticError ? cause.message : `Échec inattendu : ${cause}`,
  );
  process.exit(1);
}
