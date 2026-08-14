# WOURI Control Plane

Documentation du plan de contrôle : ce que WOURI sait faire, qui a le droit de le
faire, depuis quelle surface, et ce qu'il en reste dans le journal.

## Par où commencer

| Vous êtes | Lisez d'abord |
| --- | --- |
| Nouveau sur le projet | `architecture.md` |
| En train d'ajouter une fonction | `permission-model.md`, puis `operations.md` |
| Face à un incident | `incident-response.md` |
| Un agent IA | `mcp.md`, puis la ressource `wouri://policy` |
| En préparation de mise en production | `production-safety.md` |

## Les documents

| Fichier | Contenu | Origine |
| --- | --- | --- |
| `architecture.md` | Trois surfaces, un noyau | Écrit |
| `capabilities.md` | Ce que chaque capacité autorise | Écrit |
| `permission-model.md` | Capacités, périmètres, classes de risque | Écrit |
| `parity-matrix.md` | Fonctions, capacités, risques, exposition | **Généré** |
| `console.md`, `cli.md`, `mcp.md` | Une surface chacun | Écrit, renvoie au code |
| `operations.md` | Gestes courants d'exploitation | Écrit |
| `incident-response.md` | Procédures par panne | Écrit |
| `production-safety.md` | Ce qui peut casser, et comment couper | Écrit |

`parity-matrix.md` est régénéré par `node tools/registry/build.mjs` et ne se
modifie jamais à la main : il serait faux au premier commit suivant.
`pnpm registry:check` échoue s'il est périmé.

## Ce que la documentation ne remplace pas

Quatre garanties sont tenues par des tests, pas par ces pages :

| Garantie | Test |
| --- | --- |
| Aucune fonction publique ne contourne l'autorisation | `tools/shared/authz-coverage.test.mjs` |
| Aucune capacité vérifiée par un rôle en dur | idem |
| L'outillage n'atteint aucune écriture | `tools/shared/policy.test.mjs` |
| Aucune fuite entre organisations | `convex/tenancy/isolation.test.ts` |

Une règle qu'aucun test ne défend se dégrade au premier ajout.
