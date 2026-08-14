# Modèle d'autorisation

## Ce qui décide

Une opération est autorisée par la conjonction de :

```
session  →  organisation active  →  rôle  →  capacités  →  périmètres
```

L'organisation vient **de la session**, jamais d'un argument du client. C'est la
règle qui empêche une organisation de lire les données d'une autre en changeant
un identifiant dans une requête. Deux exceptions encadrées :

- une fonction réservée à l'opérateur de plateforme (`platform.manage`) peut
  recevoir une organisation cible ;
- `scopeOrganization` accepte une organisation demandée **uniquement** si
  l'appelant est l'opérateur de plateforme, et l'ignore sinon.

Un test lit le code et échoue si une fonction publique accepte un identifiant
d'organisation sans l'un de ces deux gardes.

## Les trois portes

| Fonction | Usage | Particularité |
| --- | --- | --- |
| `authorize` | Lecture | Déterministe, sans horloge |
| `authorizeMutation` | Écriture | Utilise l'horloge serveur pour l'expiration |
| `authorizeResource` | Lecture d'une ressource par identifiant | Vérifie l'appartenance avant de renvoyer quoi que ce soit |

`authorizeResource` existe pour une raison précise : un identifiant se devine.
Vérifier la capacité sans vérifier l'appartenance laisserait lire la ressource
d'un voisin.

## Capacités

La liste canonique est dans `convex/authz/capabilities.ts`, et
`docs/convex-permissions-matrix.md` en dérive. Ni l'une ni l'autre n'est écrite
à la main deux fois : le provisioning, le seed et les tests partagent le même
objet.

Voir `capabilities.md` pour ce que chacune autorise concrètement.

## Périmètres

Un rôle peut être limité à certaines zones, cultures ou groupes. Le périmètre
s'ajoute à la capacité, il ne la remplace pas : avoir `farmers.read` ne suffit
pas si le périmètre exclut la zone de l'agriculteur.

## Classes de risque

Chaque fonction publique est classée dans `tools/registry/risk.mjs`. Le
générateur de matrice **échoue** si une fonction n'est pas classée : une nouvelle
surface ne peut donc pas entrer sans décision explicite.

| Classe | Console | CLI | MCP | Confirmation |
| --- | --- | --- | --- | --- |
| `READ` | oui | oui | oui | non |
| `SAFE_WRITE` | oui | non | non | non |
| `SENSITIVE_WRITE` | oui | non | non | **oui** |
| `DESTRUCTIVE` | protégée | non | interdit | oui |
| `SYSTEM_CRITICAL` | ADC seul | non | interdit | oui |

Une écriture est **sensible** quand son effet sort de la plateforme ou change le
comportement d'exécution : publier une alerte, modifier un consentement, activer
une version de prompt, basculer un drapeau. Toutes passent par une confirmation
qui nomme l'effet, les personnes concernées, la portée et la réversibilité.

## Ce que la Console fait de tout cela

Le menu est composé à partir des capacités renvoyées par `session/me` : une
section inaccessible n'apparaît pas. Mais **masquer n'est pas protéger** :
l'accès direct à une adresse rend un refus explicite, et le backend refuse de
toute façon. Les trois niveaux sont indépendants.

## Preuves

| Vérification | Où |
| --- | --- |
| Aucune fuite entre organisations | `convex/tenancy/isolation.test.ts` |
| Une capacité révoquée puis réattribuée | `convex/authz/assignment.test.ts` |
| Ressource d'un tiers inaccessible | `convex/authz/resource.test.ts` |
| Toute fonction publique passe par le noyau | `tools/shared/authz-coverage.test.mjs` |
| L'outillage n'atteint aucune écriture | `tools/shared/policy.test.mjs` |
