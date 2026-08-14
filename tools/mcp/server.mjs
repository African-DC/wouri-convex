#!/usr/bin/env node
import { createInterface } from "node:readline";
import { appeler, OUTILS, DiagnosticError } from "../shared/client.mjs";

/**
 * Serveur MCP WOURI (DEV-01) — diagnostic en lecture seule sur stdio.
 *
 * Il expose la meme surface que la CLI : un agent de developpement peut
 * diagnostiquer un incident depuis une trace sans jamais toucher a la base.
 *
 * Politique DEV-04 : toutes les fonctions exposees sont des requetes, le client
 * partage refuse tout appel hors du prefixe de lecture seule, et la cible par
 * defaut est le staging.
 *
 * Protocole : JSON-RPC 2.0 sur stdio, une requete par ligne.
 */

const PROTOCOL_VERSION = "2024-11-05";

// Schemas des outils, derives de la surface partagee : une seule source.
const outilsMcp = Object.entries(OUTILS).map(([nom, outil]) => {
  const properties = {};
  const required = [];
  for (const [param, description] of Object.entries(outil.parametres)) {
    const estNombre = param === "limit";
    properties[param] = {
      type: estNombre ? "number" : "string",
      description,
    };
    if (description.includes("requis")) required.push(param);
  }
  return {
    name: `wouri_${nom}`,
    description: outil.description,
    inputSchema: { type: "object", properties, required },
  };
});

function reponse(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function erreur(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

async function traiter(requete) {
  const { id, method, params } = requete;

  switch (method) {
    case "initialize":
      return reponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "wouri-mcp", version: "0.1.0" },
      });

    case "notifications/initialized":
      return null;

    case "tools/list":
      return reponse(id, { tools: outilsMcp });

    case "tools/call": {
      const nom = params?.name?.replace(/^wouri_/, "");
      const outil = OUTILS[nom];
      if (!outil) {
        return erreur(id, -32602, `Outil inconnu : ${params?.name}`);
      }
      try {
        const resultat = await appeler(outil.fonction, params?.arguments ?? {});
        return reponse(id, {
          content: [{ type: "text", text: JSON.stringify(resultat, null, 2) }],
        });
      } catch (cause) {
        const message =
          cause instanceof DiagnosticError ? cause.message : String(cause);
        // On renvoie l'echec comme contenu d'outil plutot qu'en erreur de
        // protocole : l'agent peut alors le lire et s'adapter.
        return reponse(id, {
          content: [{ type: "text", text: `Échec : ${message}` }],
          isError: true,
        });
      }
    }

    default:
      return erreur(id, -32601, `Méthode non supportée : ${method}`);
  }
}

const lecteur = createInterface({ input: process.stdin, terminal: false });

lecteur.on("line", async (ligne) => {
  const texte = ligne.trim();
  if (!texte) return;
  let requete;
  try {
    requete = JSON.parse(texte);
  } catch {
    process.stdout.write(erreur(null, -32700, "JSON invalide") + "\n");
    return;
  }
  const sortie = await traiter(requete);
  if (sortie) process.stdout.write(sortie + "\n");
});
