# WOURI — Backend Convex

Plan de données multi-tenant de WOURI : le socle Convex qui porte les
organisations, les agriculteurs, les conversations, les alertes, les sources de
connaissance et l'observabilité de la plateforme.

WOURI est une plateforme agritech et climate-tech conversationnelle multilingue
d'African Digit Consulting, destinée aux agriculteurs ivoiriens via WhatsApp, en
dioula, baoulé et français.

## Périmètre de ce dépôt

Ce dépôt contient **uniquement le plan de données**. Il ne contient ni le calcul
(ASR, TTS, NLU, LLM, audio), ni la passerelle WhatsApp, ni le site public, qui
vivent dans leurs propres dépôts.

| Ce que ce dépôt fait | Ce qu'il ne fait pas |
| --- | --- |
| Schéma multi-tenant et relations | Inférence ASR, TTS, traduction |
| Autorisation par rôles et périmètres | Passerelle WhatsApp et webhooks |
| Threads de conversation et mémoire | Interfaces web et consoles |
| Recherche documentaire avec provenance | Traitement audio lourd |
| Alertes, ciblage et cycle de diffusion | Hébergement applicatif |
| Traces d'exécution, audit, feature flags | |

## Démarrage

```bash
pnpm install
npx convex dev          # lie le dépôt à un déploiement de développement
pnpm typecheck
pnpm test:convex
```

Aucune clé externe n'est nécessaire en développement : la recherche vectorielle
utilise par défaut un modèle d'embedding local déterministe, ce qui rend les
tests reproductibles.

## Scripts

| Commande | Rôle |
| --- | --- |
| `pnpm convex:dev` | Développement avec rechargement |
| `pnpm convex:codegen` | Régénère les types Convex |
| `pnpm typecheck` | Vérification TypeScript |
| `pnpm test:convex` | Suite de tests complète |
| `pnpm convex:test:permissions` | Tests d'isolation entre organisations |
| `pnpm convex:test:alerts` | Tests du flux d'alerte |
| `pnpm convex:test:knowledge` | Tests sources, RAG et météo |

## Principes tenus par ce socle

**Cloisonnement strict entre organisations.** L'organisation autorisée est
toujours dérivée de la session, jamais d'un paramètre fourni par l'appelant.
Chaque lecture d'une ressource vérifie son appartenance. Une suite de tests
prouve l'absence de fuite entre organisations, y compris avec un identifiant
deviné.

**Refus par défaut.** Une autorisation absente, expirée ou ambiguë refuse
l'accès. Une organisation nouvellement créée ne reçoit aucun droit implicite :
son activation est un acte explicite.

**Pas de réponse sans source.** Les outils métier renvoient une abstention
explicite lorsqu'aucune donnée fiable ne couvre la question, plutôt que de
laisser un modèle inventer. Chaque réponse transporte la provenance des sources
utilisées.

**Traçabilité sans intrusion.** Les exécutions sont tracées par leur chemin
(outils appelés, sources consultées, versions, garde-fous, latences), jamais par
le raisonnement interne d'un modèle.

## Documentation

| Document | Contenu |
| --- | --- |
| [Architecture](docs/convex-architecture.md) | Tables, relations, index, flux métier |
| [Runbook](docs/convex-runbook.md) | Environnements, déploiement, tests, seed |
| [Matrice des permissions](docs/convex-permissions-matrix.md) | Rôles et capacités |
| [Fondation](docs/convex-foundation.md) | Décisions de la transition |

## Environnements

Chaque environnement est un projet Convex distinct, avec ses propres données et
ses propres secrets. Les détails opérationnels figurent dans le runbook.

## Licence

Code propriétaire African Digit Consulting.
