# Outils de diagnostic WOURI

Serveur MCP (DEV-01) et CLI (DEV-02) permettant de diagnostiquer un incident
depuis une trace, sans accès brut à la base de données.

## Politique d'accès (DEV-04)

Cette politique n'est pas seulement écrite, elle est **appliquée dans le code**
(`shared/client.mjs`) :

- **Lecture seule, sans exception.** Seules les fonctions du préfixe
  `diagnostics/readonly:` sont appelables, et toutes sont des requêtes. Aucune
  mutation n'est joignable, y compris par erreur.
- **Aucune action destructive possible.** Il n'existe pas de commande d'écriture
  dans ces outils. Un agent de développement ne peut donc rien casser en les
  utilisant.
- **Staging par défaut.** La production doit être demandée explicitement
  (`--cible prod`) et reste, elle aussi, en lecture seule.
- **Pas de données personnelles.** Les fonctions renvoient des identifiants, des
  statuts, des compteurs et des métadonnées. Le contenu des messages d'une
  conversation n'est jamais exposé, et le raisonnement interne d'un modèle n'est
  ni enregistré ni consultable.
- **Aucune voie d'authentification parallèle.** Les outils délèguent à la CLI
  Convex, qui porte déjà l'authentification par clé de déploiement. Aucun jeton
  n'est manipulé ici.

Le garde-fou est vérifiable : tenter d'appeler une fonction hors préfixe échoue
avec un refus explicite, avant même d'atteindre le réseau.

## CLI

```bash
node tools/cli/wouri.mjs doctor            # accès + état de santé
node tools/cli/wouri.mjs health
node tools/cli/wouri.mjs traces --statut failed --limite 10
node tools/cli/wouri.mjs trace <identifiant>
node tools/cli/wouri.mjs errors --type ASR_ERROR
node tools/cli/wouri.mjs sources
node tools/cli/wouri.mjs corpus dyu --contient cacao
node tools/cli/wouri.mjs conversation <identifiant>
```

Options communes : `--cible prod|dev`, `--limite N`.

## Serveur MCP

Protocole JSON-RPC 2.0 sur stdio. Déclaration côté client :

```json
{
  "mcpServers": {
    "wouri": {
      "command": "node",
      "args": ["tools/mcp/server.mjs"],
      "cwd": "<chemin du dépôt wouri-convex>"
    }
  }
}
```

Outils exposés : `wouri_health`, `wouri_traces`, `wouri_trace`, `wouri_errors`,
`wouri_sources`, `wouri_corpus`, `wouri_conversation`.

La CLI et le MCP partagent la même surface, définie une seule fois dans
`shared/client.mjs` : les deux ne peuvent pas diverger.

## Diagnostiquer un incident

1. `wouri doctor` pour confirmer l'accès et repérer un pic d'échecs.
2. `wouri traces --statut failed` pour isoler les exécutions en échec.
3. `wouri trace <identifiant>` pour lire la chronologie : quel outil a échoué, à
   quelle étape, avec quelles versions de prompt et de politique.
4. `wouri errors --type <type>` pour voir si l'erreur se répète.
5. `wouri sources` pour vérifier qu'une source attendue est bien présente et à
   jour.

Une **abstention** n'est pas un échec : c'est le système qui refuse de répondre
faute de source fiable. Elle est comptée séparément dans `health`.
