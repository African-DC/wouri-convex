# Outils de diagnostic WOURI

Serveur MCP (DEV-01) et CLI (DEV-02) permettant de diagnostiquer un incident
depuis une trace, sans accès brut à la base de données.

## Politique d'accès (DEV-04)

Cette politique n'est ni seulement écrite ni seulement codée : elle est
**défendue par des tests** (`shared/policy.test.mjs`, `pnpm test:tools`). Une
politique qu'aucun test ne protège se dégrade au premier ajout d'outil.

- **Lecture seule, sans exception.** Seules les fonctions du préfixe
  `diagnostics/readonly:` sont appelables, et toutes sont des requêtes. Aucune
  mutation n'est joignable, y compris par erreur. Un test le vérifie en tentant
  réellement d'appeler `publishAlert` et `withdrawConsent`.
- **Aucune fonction sensible reflétée.** Chaque diagnostic déclare, par un
  commentaire `@reflete`, la fonction publique dont il est le reflet. Un test
  croise ces déclarations avec le classement de risque et échoue si l'une d'elles
  n'est pas classée `READ`.
- **Rien ne vise un environnement supérieur par omission** (§73). Le déploiement
  par défaut est `dev` ; `--deploiement staging` doit être demandé. Le drapeau
  `--prod` de Convex désigne le déploiement de production du *projet* Convex,
  qui héberge aujourd'hui les données de staging de WOURI : les deux vocabulaires
  ne se recouvrent pas, et la traduction se fait à un seul endroit.
- **Pas de données personnelles.** Les fonctions renvoient des identifiants, des
  statuts, des compteurs et des métadonnées. Le contenu des messages n'est jamais
  exposé, ni un numéro de téléphone, ni un secret d'intégration, ni le
  raisonnement interne d'un modèle.
- **Aucune voie d'authentification parallèle.** Les outils délèguent à la CLI
  Convex, qui porte déjà l'authentification par clé de déploiement. Aucun jeton
  n'est manipulé ici.

## CLI

```bash
node tools/cli/wouri.mjs doctor --deploiement staging
node tools/cli/wouri.mjs health
node tools/cli/wouri.mjs organizations
node tools/cli/wouri.mjs traces --statut failed --limite 10
node tools/cli/wouri.mjs trace <identifiant>
node tools/cli/wouri.mjs errors --type ASR_ERROR
node tools/cli/wouri.mjs sources
node tools/cli/wouri.mjs corpus dyu --contient cacao
node tools/cli/wouri.mjs farmer <identifiant>
node tools/cli/wouri.mjs alert <identifiant>
node tools/cli/wouri.mjs audit --action alert.publish
node tools/cli/wouri.mjs conversation <identifiant>
```

Options communes :

| Option | Effet |
| --- | --- |
| `--deploiement dev\|staging` | Déploiement visé. Défaut : `dev`. |
| `--json` | Sortie JSON stable, pour un agent ou un script (§55). |
| `--limite N` | Plafond de lignes. |

Sortie lisible par défaut, tableau pour les listes. Code de sortie `0` en cas de
succès, non nul sinon (§102) : la CLI est utilisable dans un script sans analyse
de texte.

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

**Outils** (11, tous en lecture) : `wouri_health`, `wouri_organizations`,
`wouri_traces`, `wouri_trace`, `wouri_errors`, `wouri_sources`, `wouri_corpus`,
`wouri_farmer`, `wouri_alert`, `wouri_audit`, `wouri_conversation`.

**Ressources** (§61) — ce qu'un agent doit lire avant d'agir. Un agent qui ne
connaît ni les capacités, ni la politique de risque, ni les procédures finit par
inventer une action plausible.

| URI | Contenu |
| --- | --- |
| `wouri://policy` | Ce que l'agent peut et ne peut pas faire. À lire en premier. |
| `wouri://capabilities` | Fonctions publiques, capacités, risques, parité. |
| `wouri://permissions` | Capacités par rôle et périmètres. |
| `wouri://architecture` | Domaines, schéma, autorisation, provenance. |
| `wouri://runbooks` | Déploiement, variables, tests de fumée. |

La CLI et le MCP partagent la même surface, définie une seule fois dans
`shared/client.mjs` : les deux ne peuvent pas diverger.

## Ce que l'agent ne peut pas faire

Publier une alerte, écrire à un agriculteur, modifier un consentement, activer
une version de prompt ou de modèle, basculer un drapeau, suspendre une
organisation, lire un secret, exporter des données personnelles. Ces opérations
existent, mais passent par la Console avec une confirmation humaine explicite
(§64-65).

Il n'existe pas non plus d'outil générique du type `execute_sql` ou
`run_command` : les outils sont métier et bornés (§104).

## Diagnostiquer un incident

1. `wouri doctor --deploiement staging` pour confirmer l'accès et repérer un pic
   d'échecs.
2. `wouri traces --statut failed` pour isoler les exécutions en échec.
3. `wouri trace <identifiant>` pour lire la chronologie : quel outil a échoué, à
   quelle étape, avec quelles versions de prompt, de politique et de modèle.
4. `wouri errors --type <type>` pour voir si l'erreur se répète.
5. `wouri sources` pour vérifier qu'une source attendue est présente et à jour.
6. `wouri audit --action <action>` pour savoir si un changement de configuration
   précède l'incident.

Une **abstention** n'est pas un échec : c'est le système qui refuse de répondre
faute de source fiable. Elle est comptée séparément dans `health`.
