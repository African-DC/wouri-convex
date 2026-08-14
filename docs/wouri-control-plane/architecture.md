# Architecture du Control Plane WOURI

## Le principe

Trois surfaces, un seul noyau.

```
        WOURI CONSOLE      WOURI CLI       WOURI MCP
          humains          opérateurs      agents IA
              │                │                │
              └────────────────┼────────────────┘
                               ▼
                   Capacité + périmètre + audit
                               ▼
                  Convex : état, règles, provenance
```

Aucune des trois surfaces ne réimplémente une règle métier. La Console appelle
les fonctions publiques Convex ; la CLI et le MCP appellent une surface de
diagnostic en lecture seule. Toutes passent par la même décision d'autorisation.

Ce n'est pas une intention : c'est vérifié. `tools/shared/authz-coverage.test.mjs`
lit le code de chaque fonction publique et échoue si l'une d'elles contourne le
noyau, n'exige aucune capacité nommée, ou accepte un identifiant d'organisation
sans le faire passer par un garde.

## Les trois plans

| Plan | Responsable | Contenu |
| --- | --- | --- |
| Données | Convex (`wouri-convex`) | État métier, permissions, temps réel, provenance, audit |
| Calcul | FastAPI et workers | Reconnaissance vocale, synthèse, traduction, modèles, audio |
| Présentation | Console, site public | Aucune donnée propre : consomme les deux |

La frontière entre données et calcul est fixée par l'ADR-0025.

## Ce que chaque surface peut faire

| | Console | CLI | MCP |
| --- | --- | --- | --- |
| Lecture | Oui, selon capacité et périmètre | Oui, opérateur muni d'une clé | Oui, mêmes fonctions |
| Écriture réversible | Oui | Non | Non |
| Écriture sensible | Oui, avec confirmation | Non | Non |
| Destruction | Non exposée | Non | Interdite |

La CLI et le MCP ne sont pas des Console dégradées : ce sont des outils de
diagnostic. Ils n'écrivent rien, par construction et non par convention. Le
détail est dans `cli.md` et `mcp.md`.

## Authentification, selon la surface

La Console authentifie une **session** : Better Auth vit dans Convex, la session
porte l'organisation active, et chaque fonction dérive le périmètre de cette
session — jamais d'un argument du client.

La CLI et le MCP authentifient un **opérateur** par clé de déploiement. Il n'y a
donc pas de session, donc pas de périmètre par organisation : c'est précisément
pourquoi ces outils sont en lecture seule et n'exposent aucune donnée
personnelle. Un diagnostic renvoie des identifiants, des statuts et des
compteurs ; jamais le contenu d'un message ni un numéro de téléphone.

## Modèle d'erreurs

La taxonomie vit dans `convex/lib/errors.ts` et sert aux traces, aux
signalements linguistiques et aux refus. Les trois surfaces la partagent : une
erreur porte un type de la taxonomie et un message destiné à l'utilisateur,
jamais une pile d'exécution.

## Ce qui n'existe pas, volontairement

- **Aucun outil générique.** Pas de `execute_sql`, pas de `run_command`, pas de
  `mutate_anything`. Les outils sont métier et bornés (§104).
- **Aucun contrôle de rôle en dur.** Le code demande une capacité nommée, jamais
  `role === "admin"`. Un test le vérifie.
- **Aucune écriture sans capacité.** Aucune fonction publique n'échappe au
  noyau ; un test le vérifie aussi.

## Documents liés

| Document | Contenu |
| --- | --- |
| `parity-matrix.md` | Généré : fonctions, capacités, risques, exposition |
| `capabilities.md` | Ce que chaque capacité autorise |
| `permission-model.md` | Capacités, périmètres, classes de risque |
| `console.md`, `cli.md`, `mcp.md` | Une surface chacun |
| `operations.md` | Gestes courants d'exploitation |
| `incident-response.md` | Procédures par panne |
| `production-safety.md` | Ce qui peut casser, et comment couper |
