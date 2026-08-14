#!/usr/bin/env node
import {
  appeler,
  OUTILS,
  DiagnosticError,
  DEPLOIEMENTS,
  DEPLOIEMENT_PAR_DEFAUT,
  resoudreDeploiement,
} from "../shared/client.mjs";

/**
 * CLI WOURI (DEV-02) — diagnostic en lecture seule.
 *
 * Usage :
 *   wouri doctor
 *   wouri health
 *   wouri organizations
 *   wouri traces [--statut failed] [--limite 10]
 *   wouri trace <id>
 *   wouri errors [--type ASR_ERROR]
 *   wouri sources
 *   wouri corpus <langue> [--contient cacao]
 *   wouri farmer <id>
 *   wouri alert <id>
 *   wouri audit [--action alert.publish]
 *   wouri conversation <id>
 *
 * Le deploiement est EXPLICITE : `--deploiement dev` par defaut, `staging` sur
 * demande. Rien ne vise un environnement superieur par omission (§73). Aucune
 * commande de ce binaire n'ecrit quoi que ce soit.
 *
 * Sortie lisible par defaut, `--json` pour un agent ou un script (§55). Code de
 * sortie 0 en cas de succes, non nul sinon (§102).
 */

const args = process.argv.slice(2);
const commande = args[0];

function drapeau(nom) {
  return args.includes(`--${nom}`);
}

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

const enJson = drapeau("json");
const deploiement = option("deploiement");
const limite = option("limite");
const limitArg = limite ? { limit: Number(limite) } : {};

/**
 * Rend une valeur lisible par un humain, ou son JSON exact si `--json`.
 * Une liste d'objets homogenes devient un tableau : c'est la forme que
 * renvoient presque toutes les commandes.
 */
function afficher(valeur) {
  if (enJson) {
    console.log(JSON.stringify(valeur, null, 2));
    return;
  }
  if (valeur === null || valeur === undefined) {
    console.log("Aucun résultat.");
    return;
  }
  if (Array.isArray(valeur)) {
    if (valeur.length === 0) {
      console.log("Aucun résultat.");
      return;
    }
    if (valeur.every((ligne) => ligne && typeof ligne === "object" && !Array.isArray(ligne))) {
      console.table(valeur.map(aplatir));
      return;
    }
    console.log(valeur.join("\n"));
    return;
  }
  if (typeof valeur === "object") {
    for (const [cle, contenu] of Object.entries(aplatir(valeur))) {
      console.log(`${cle.padEnd(22)} ${contenu}`);
    }
    return;
  }
  console.log(String(valeur));
}

/** console.table n'affiche pas les objets imbriques : on les resume. */
function aplatir(objet) {
  const sortie = {};
  for (const [cle, valeur] of Object.entries(objet)) {
    if (valeur === null || valeur === undefined) sortie[cle] = "";
    else if (Array.isArray(valeur)) sortie[cle] = `${valeur.length} élément(s)`;
    else if (typeof valeur === "object") sortie[cle] = JSON.stringify(valeur);
    else if (cle.endsWith("A") || cle === "createdAt" || cle === "creeA")
      sortie[cle] = new Date(valeur).toISOString().slice(0, 16).replace("T", " ");
    else sortie[cle] = valeur;
  }
  return sortie;
}

function aide() {
  console.log("\nCLI WOURI — diagnostic en lecture seule\n");
  for (const [nom, outil] of Object.entries(OUTILS)) {
    console.log(`  wouri ${nom.padEnd(15)} ${outil.description}`);
  }
  console.log(`  wouri ${"doctor".padEnd(15)} Vérifie l'accès et affiche l'état de santé.\n`);
  console.log(
    `  Options : --deploiement ${Object.keys(DEPLOIEMENTS).join("|")} (défaut ${DEPLOIEMENT_PAR_DEFAUT})`,
  );
  console.log("            --json   sortie JSON stable, pour un agent ou un script");
  console.log("            --limite N\n");
  console.log("  Aucune commande de cet outil ne modifie l'état de la plateforme.\n");
}

/** Appelle un outil de la surface partagée avec les arguments donnés. */
const invoquer = (nom, arguments_ = {}) =>
  appeler(OUTILS[nom].fonction, arguments_, { deploiement });

function exigerPositionnel(index, message) {
  const valeur = positionnel(index);
  if (!valeur) throw new DiagnosticError(message);
  return valeur;
}

try {
  switch (commande) {
    case "doctor": {
      const { nom } = resoudreDeploiement(deploiement);
      const etat = await invoquer("health");
      console.log(`Déploiement visé     : ${nom}`);
      console.log("Accès                : OK");
      console.log(`Environnement WOURI  : ${etat.environnement}`);
      console.log(
        `Organisations        : ${etat.organisations} (${etat.organisationsActives} actives)`,
      );
      console.log(`Traces récentes      : ${etat.tracesRecentes}`);
      console.log(`Abstentions          : ${etat.abstentions}`);
      console.log(`Échecs               : ${etat.echecs}`);
      if (etat.environnement === "production") {
        console.log(
          "\nAttention : ce déploiement porte des données de production. Cet outil reste en lecture seule.",
        );
      }
      break;
    }
    case "health":
      afficher(await invoquer("health"));
      break;
    case "organizations":
      afficher(await invoquer("organizations", limitArg));
      break;
    case "traces": {
      const statut = option("statut");
      afficher(
        await invoquer("traces", {
          ...(statut ? { resultStatus: statut } : {}),
          ...limitArg,
        }),
      );
      break;
    }
    case "trace":
      afficher(
        await invoquer("trace", {
          traceId: exigerPositionnel(0, "Identifiant de trace manquant."),
        }),
      );
      break;
    case "errors": {
      const type = option("type");
      afficher(
        await invoquer("errors", { ...(type ? { errorType: type } : {}), ...limitArg }),
      );
      break;
    }
    case "sources":
      afficher(await invoquer("sources", limitArg));
      break;
    case "corpus": {
      const langue = exigerPositionnel(
        0,
        "Langue manquante, par exemple : wouri corpus dyu",
      );
      const contient = option("contient");
      afficher(
        await invoquer("corpus", {
          language: langue,
          ...(contient ? { contient } : {}),
          ...limitArg,
        }),
      );
      break;
    }
    case "farmer":
      afficher(
        await invoquer("farmer", {
          farmerId: exigerPositionnel(0, "Identifiant d'agriculteur manquant."),
        }),
      );
      break;
    case "alert":
      afficher(
        await invoquer("alert", {
          alertId: exigerPositionnel(0, "Identifiant d'alerte manquant."),
        }),
      );
      break;
    case "audit": {
      const action = option("action");
      const organisation = option("organisation");
      afficher(
        await invoquer("audit", {
          ...(action ? { action } : {}),
          ...(organisation ? { organizationId: organisation } : {}),
          ...limitArg,
        }),
      );
      break;
    }
    case "conversation":
      afficher(
        await invoquer("conversation", {
          contextId: exigerPositionnel(0, "Identifiant de conversation manquant."),
        }),
      );
      break;
    default:
      aide();
      process.exit(commande ? 1 : 0);
  }
} catch (cause) {
  const message =
    cause instanceof DiagnosticError ? cause.message : `Échec inattendu : ${cause}`;
  if (enJson) console.log(JSON.stringify({ erreur: message }, null, 2));
  else console.error(message);
  process.exit(1);
}
