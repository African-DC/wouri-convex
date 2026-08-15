# ADR-0025 : frontière entre le plan de données Convex et les index de service du calcul

**Statut** : proposée
**Date** : 2026-08-13
**Auteur(s)** : Claude, sous direction de l'équipe WOURI
**Valideur** : en attente
**Exécute** : [ADR-0024](0024-transition-convex-multitenant.md)
**Lié à** : ADR-0001 et ADR-0008 du dépôt applicatif, issue #372

---

## Contexte

ADR-0024 a acté que Convex devient le plan de données des domaines multi-tenant,
et que FastAPI reste le service de calcul. Il a explicitement laissé une question
ouverte : *« PostgreSQL et pgvector restent propriétaires du corpus IVR existant
jusqu'à une décision de migration séparée. »* Cet ADR est cette décision.

### Ce que pgvector porte réellement

pgvector ne stocke pas « la connaissance de WOURI ». Il porte le **corpus IVR** :
des phrases dioula et bambara validées, indexées par intention et culture, avec
une recherche en cascade à trois essais et un scoring saisonnier. C'est ce qui
alimente le Fast Path (AI-03 de la roadmap) : répondre à une salutation ou une
phrase courante sans réveiller le pipeline complet.

Caractéristiques mesurées au moment de la décision :

- volume de l'ordre de 150 Ko de données de corpus ;
- modèle d'embedding `paraphrase-multilingual-MiniLM-L12-v2`, 384 dimensions,
  chargé **dans le processus Python** qui fait aussi l'ASR ;
- logique métier en Python, testée : cascade intention/culture, scoring
  saisonnier et conditionnel ;
- consommé sur le chemin chaud, à chaque message entrant.

### Le problème réel

Le corpus est aujourd'hui **à la fois la source de vérité et l'index de
service**. C'est le vrai défaut, pas son emplacement. Quand un
locuteur-validateur corrige une phrase, rien ne garantit ni ne trace qui a
validé, quand, ni dans quelle version. La porte de validation G09 exige une
correction linguistique versionnée et réinjectable : un index de recherche ne
peut pas tenir ce rôle.

## Décision

**Le corpus IVR reste servi depuis pgvector, côté calcul. Sa gouvernance passe
sous Convex.**

Trois raisons de ne pas déplacer le service :

1. **Chemin chaud.** Chaque message traverse le Fast Path. Un aller-retour vers
   Convex Cloud annulerait l'intérêt même du Fast Path.
2. **Le modèle d'embedding vit dans le processus de calcul.** Éloigner les
   vecteurs du modèle qui les produit est architecturalement à l'envers.
3. **Les deux espaces vectoriels sont incompatibles.** Le RAG Convex utilise un
   embedding local déterministe à 256 dimensions, adapté à des tests
   reproductibles mais sémantiquement inférieur à MiniLM. Migrer aujourd'hui
   dégraderait la qualité de recherche d'un système qui fonctionne.

### La frontière

| Plan | Détient | Exemple |
| --- | --- | --- |
| **Convex** | La gouvernance : qui a validé quoi, quand, quelle version, avec audit | `approvedPhrases`, `approvedPhraseVersions`, `glossaryTerms`, `languageExamples`, `linguisticFeedback` |
| **Calcul** | Le service : index optimisé pour la latence | corpus pgvector, caches, index vectoriels locaux |

### La règle qui rend la frontière vérifiable

**Tout index de service doit être reconstructible depuis sa source Convex.** Si
l'on supprime la base pgvector, on la reprojette depuis Convex et l'on ne perd
rien. C'est le test qui distingue une projection légitime d'un second entrepôt
de données. Un index qui ne passe pas ce test est une source de vérité déguisée,
et doit être corrigé.

Le sens du flux est unique :

```
correction du validateur
        ↓
Convex : linguisticFeedback → validation → promoteToApprovedPhrase
        ↓  (versions numérotées, jamais écrasées, auditées)
projection
        ↓
pgvector : index de service du Fast Path
        ↓
réponse en millisecondes
```

Jamais l'inverse : le calcul ne remonte pas d'état métier vers Convex autrement
qu'en appelant une fonction Convex, qui applique les permissions et l'audit.

## Portée générale : les trois plans

Cette frontière se généralise à toute application WOURI présente et à venir.

| Plan | Responsable | Contenu |
| --- | --- | --- |
| Données | Convex | État métier, permissions, temps réel, gouvernance, provenance, traces |
| Calcul | FastAPI et services worker | ASR, TTS, NLU, traduction, LLM, audio, et leurs index de service |
| Présentation | Site, consoles, mobile | Aucune donnée propre : consomme les deux |

Quatre règles :

1. **Une donnée, un propriétaire.** Jamais de double écriture. Si une donnée
   existe des deux côtés, l'une des deux est une projection reconstructible, et
   c'est écrit.
2. **Le calcul n'écrit pas l'état métier directement.** Il appelle des fonctions
   Convex. Sinon les permissions et l'audit sont contournés.
3. **Tout index dérivé est jetable.** Sans exception.
4. **Toute nouvelle application passe par Convex pour les données.** C'est ce qui
   lui fait hériter gratuitement du cloisonnement entre organisations, de
   l'audit et du temps réel.

## Conséquences

### Positives

- G09 devient réellement satisfaite : Convex versionne et audite, pgvector sert.
- Le Fast Path conserve sa latence et sa qualité de recherche actuelles.
- Aucune migration risquée d'un système en fonctionnement.
- La gouvernance du corpus est centralisée sur la plateforme (voir l'addendum
  ci-dessous sur la propriété).

### Négatives et coûts assumés

- Deux stockages à opérer au lieu d'un.
- Un travail de projection reste à écrire : il n'existe pas encore.
- Tant qu'il n'existe pas, le corpus pgvector demeure de fait sa propre source
  de vérité. C'est une dette explicite, pas un état cible.

### Travaux induits

1. Écrire le job de projection depuis `listApprovedPhrases` vers l'index pgvector.
2. Faire passer les nouvelles validations par `promoteToApprovedPhrase` plutôt
   que par une édition directe des fichiers JSON.
3. Reléguer les fichiers JSON de corpus au rang d'artefact d'export.
4. Réévaluer cette décision si le corpus change d'ordre de grandeur, ou si le
   RAG Convex adopte un modèle d'embedding sémantique comparable à MiniLM.

## Références

- ADR-0001 (depot applicatif) : choix PostgreSQL et pgvector
- ADR-0008 (depot applicatif) : migration ChromaDB vers pgvector
- [ADR-0024](0024-transition-convex-multitenant.md) : transition Convex multi-tenant
- Roadmap Focus Dev : AI-03 (Fast Path), LNG-04 (corpus versionnés), G09

## Addendum — propriété du corpus (2026-08-15)

Décision de Marcel : **le corpus est une propriété d'ADC.** La langue validée
(dioula, français) est un actif de la plateforme, produit par les validateurs
linguistes d'ADC, qui peuvent rejouer des conversations pour corriger une
traduction mal comprise. Il est **servi à toutes les organisations** clientes,
mais **aucune ne le valide** : demander à une coopérative de valider reviendrait
à lui faire faire le travail d'ADC, et à admettre que l'outil ne fonctionne pas
seul.

Le corpus est donc **partagé au niveau plateforme**, pas cloisonné par tenant.
Conséquence appliquée dans le code : les mutations d'écriture du corpus
(`promoteToApprovedPhrase`, `promoteToGlossary`, `promoteToCorpus`,
`importCorpus`) exigent désormais l'organisation plateforme
(`assertPlatformOrganization`). Une coopérative, même dotée du droit de
validation linguistique, est refusée. Test : `convex/language/corpusOwnership.test.ts`.

Cela ferme aussi le risque relevé en revue d'une fusion cross-tenant de deux
demi-paires (français d'un tenant, dioula d'un autre) : un seul émetteur écrit le
corpus, la fusion accidentelle ne peut plus se produire.

## Historique

- 2026-08-13 : rédaction, à la suite de la question de migration du corpus posée
  après l'extraction du backend Convex dans son propre dépôt.
- 2026-08-15 : addendum propriété du corpus (ADC seul valide), verrou plateforme
  appliqué aux mutations d'écriture.
