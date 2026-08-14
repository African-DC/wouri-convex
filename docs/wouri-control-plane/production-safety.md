# Sûreté de production

## Ce qui peut casser, et ce qu'on peut en faire

| Brique | Signe visible | Coupure possible | État |
| --- | --- | --- | --- |
| Convex | `wouri doctor` échoue | — | Branchée |
| Diffusion WhatsApp | Livraisons bloquées en « créées » | Drapeau | **Non branchée** |
| **Génération de réponse** | — | — | **Non branchée** |
| Fournisseur de modèle | Traces en échec, latence | — | Non branché |
| Reconnaissance vocale | Erreurs `ASR_ERROR` | Drapeau par langue | Non branchée |
| Traduction | Erreurs `TRANSLATION_ERROR` | Drapeau | Non branchée |
| Synthèse vocale | Erreurs `TTS_PRONUNCIATION` | Drapeau | Non branchée |
| Recherche documentaire | Abstentions en hausse | Retirer la version de source | Branchée |
| Ingestion météo | Source périmée | Retirer la version | Fixtures |
| Démo publique | Consommation anormale | Drapeau | Non construite |

Le tableau dit la vérité plutôt que de décrire l'architecture cible : une brique
« non branchée » ne peut pas tomber, mais elle ne peut pas non plus être
diagnostiquée.

## Coupures disponibles

Deux mécanismes, tous deux immédiats et journalisés.

**Feature flags.** Créés désactivés — une fonctionnalité pilotée par drapeau doit
être coupée par défaut. La bascule demande une confirmation qui nomme
l'environnement : une bascule sur le mauvais déploiement transforme un incident
en deux incidents.

**Registres.** Une seule coupure existe aujourd'hui, celle des drapeaux.

Les registres de prompt, de politique et de modèle sont un **inventaire
versionné, pas un levier**. Le pipeline de réponse
(`convex/pipeline/answer.ts`) compose ses réponses par concaténation des passages
trouvés : il n'appelle aucun modèle de langue et ne lit aucun `template`.
Réactiver une version antérieure **ne change donc rien au comportement**.

Ce que les registres apportent réellement : chaque trace porte les versions en
vigueur au moment de l'exécution, ce qui rendra un incident rejouable le jour où
la génération sera branchée. Les activer et les retirer prépare ce jour, cela ne
corrige pas un incident aujourd'hui.

Ce qu'il n'y a pas : un interrupteur général, ni de levier sur la génération.
Couper WOURI entièrement se fait au niveau du déploiement, pas depuis la Console.

## Règles de production

- **Aucun seed en production.** `WOURI_ENV=production` fait refuser toutes les
  fonctions de seed, y compris celle des registres.
- **Aucune copie de la production vers staging.**
- **Migrations non destructives seulement.** Ajouter un champ optionnel et
  migrer par mutation idempotente, jamais recréer une table.
- **Aucun secret en base ni dans un écran.** Les configurations de modèle
  portent des paramètres, jamais une clé.
- **Rien ne vise la production par omission** dans l'outillage : le déploiement
  par défaut est celui de développement.

## Ce qui est journalisé

Toute opération sensible : activation d'organisation, publication de source ou
d'alerte, annulation, consentement enregistré ou retiré, décision de validation,
promotion au corpus ou au glossaire, import, bascule de drapeau, activation de
version, capture d'instantané.

Le journal porte l'auteur, la ressource, l'horodatage et des instantanés avant et
après. **Aucun secret, aucun contenu de message.**

## Ce qui n'est pas encore couvert

- Pas de sauvegarde applicative pilotée depuis la Console : la restauration
  dépend de Convex et suit la procédure du runbook.
- Pas de circuit d'approbation à deux personnes. Les écritures sensibles
  demandent une confirmation, pas une seconde signature.
- Pas de plafond de coût par organisation : les droits de plan portent des
  limites d'usage, pas de budget.
- Pas de limitation de débit applicative. La démo publique en aura besoin avant
  d'être ouverte.

Chacune de ces absences est un choix assumé pour le pilote, pas un oubli. Elles
deviennent nécessaires à mesure que le nombre d'organisations augmente.
