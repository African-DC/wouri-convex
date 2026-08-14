# Capacités WOURI

Liste canonique : `convex/authz/capabilities.ts`. Ce document dit ce que chaque
capacité **autorise concrètement**, ce que le nom seul ne raconte pas.

La répartition par rôle est dans `docs/convex-permissions-matrix.md`, générée
depuis les mêmes préréglages. Le rattachement capacité → fonctions est dans
`parity-matrix.md`, généré depuis le code.

## Organisation et plateforme

| Capacité | Autorise |
| --- | --- |
| `organization.read` | Lire son organisation, ses droits de plan et sa session |
| `platform.manage` | Voir et activer les organisations, cibler une autre organisation dans les fonctions qui l'acceptent |

`platform.manage` est la capacité qui lève le cloisonnement : elle ne se donne
qu'à l'opérateur de plateforme.

## Agriculteurs et consentements

| Capacité | Autorise |
| --- | --- |
| `farmers.read` | Liste, fiche, zones, cultures, groupes |
| `farmers.write` | Inscrire, modifier, rattacher à une zone, une culture, un groupe |
| `consents.write` | Enregistrer et retirer un consentement |

`consents.write` est séparée de `farmers.write` à dessein : le consentement
décide de ce qu'on a le droit d'envoyer, il n'est pas une donnée de profil comme
une autre. Un agriculteur sans consentement en cours de validité est exclu de
toute audience.

## Alertes et conversations

| Capacité | Autorise |
| --- | --- |
| `alerts.read` | Alertes, conversations, fils de messages |
| `alerts.create` | Rédiger une alerte, poser un ciblage, chiffrer une audience |
| `alerts.publish` | Publier, et interrompre une diffusion |

`alerts.create` et `alerts.publish` sont distinctes parce que rédiger n'engage
rien alors que publier envoie vers des téléphones réels, sans rappel possible.

## Connaissance et langues

| Capacité | Autorise |
| --- | --- |
| `knowledge.read` | Sources, provenance, corpus approuvé |
| `knowledge.ingest` | Verser un document dans l'index |
| `sources.publish` | Créer une source et une nouvelle version |
| `weather.publish` | Publier une observation météo |
| `linguistic.validate` | Signaler, relire, décider, promouvoir au glossaire ou au corpus |

Une nouvelle version de source devient la référence servie : c'est pourquoi
`sources.publish` est une écriture sensible et non une écriture ordinaire.

## Exploitation

| Capacité | Autorise |
| --- | --- |
| `aiops.read` | Traces, erreurs, registres de prompts, politiques et modèles |
| `aiops.replay` | Figer une exécution, lire les instantanés |
| `featureflags.manage` | Créer et basculer un drapeau, activer une version de registre |
| `audit.read` | Journal des opérations sensibles |

`featureflags.manage` porte aussi l'activation des registres : dans les deux cas
il s'agit de changer le comportement d'exécution sans redéploiement, et c'est le
même niveau de responsabilité.

## Ce qu'aucune capacité n'autorise

Supprimer une organisation, effacer un corpus, écrire massivement aux
agriculteurs depuis un outil de debug, lire un secret, exporter l'ensemble des
données personnelles. Ces opérations ne sont pas seulement non exposées : elles
n'existent pas dans le code.
