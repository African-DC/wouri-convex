# Réponse aux incidents

Chaque procédure suit le même ordre : constater, isoler, comprendre, corriger,
vérifier. Les commandes visent `--deploiement staging` ; rien ne cible un
environnement supérieur par omission.

## Réflexe commun

```bash
node tools/cli/wouri.mjs doctor --deploiement staging
node tools/cli/wouri.mjs traces --statut failed --limite 20 --deploiement staging
node tools/cli/wouri.mjs audit --limite 20 --deploiement staging
```

Le journal d'audit répond à la question qu'on oublie de poser : **est-ce qu'un
changement de configuration précède la panne ?** Une activation de prompt, une
bascule de drapeau ou une nouvelle version de source explique la majorité des
régressions soudaines.

## Une réponse est fausse ou inventée

1. Retrouver la conversation, puis la trace correspondante.
2. `wouri trace <id>` : lire les étapes. Un garde-fou `evidence-required` en
   échec signifie que le système a refusé de répondre — ce n'est pas une panne.
3. Vérifier les versions portées par la trace : prompt, politique, modèle. Elles
   disent quelle configuration était en vigueur, **elles ne permettent pas encore
   de corriger** : voir l'avertissement ci-dessous.
4. `wouri sources` : la source attendue est-elle présente et à jour ?
5. Figer l'exécution depuis la fiche de trace : l'instantané garde la
   configuration fautive pour l'analyse.
6. La correction réelle passe aujourd'hui par la source, pas par la
   configuration : retirer ou reverser une version de source erronée.

> **Ne comptez pas sur les registres pour éteindre un incident.** La génération
> de réponse n'appelle aucun modèle : le pipeline concatène les passages trouvés.
> Réactiver une version antérieure de prompt ou de modèle ne change rien au
> comportement observé. Les registres servent à savoir ce qui était en vigueur,
> pas à agir dessus. Voir `production-safety.md`.

## Une traduction est mauvaise

Ce n'est pas un incident technique mais une correction de corpus.

1. **Validation linguistique** → « Signaler une correction ».
2. Un relecteur valide, puis intègre au corpus ou au glossaire.
3. L'intégration crée une version ; la précédente reste consultable.

Ne jamais corriger en base : le versionnement est la trace de qui a décidé quoi.

## Une alerte n'atteint personne

1. Ouvrir la fiche d'alerte : le ciblage est-il posé ?
2. Lire les trois nombres de l'audience. Un écart entre **ciblés** et
   **joignables** signifie que des agriculteurs n'ont pas de consentement en
   cours de validité : c'est le fonctionnement attendu, pas une panne.
3. L'entonnoir de diffusion distingue « créées » de « envoyées ». Tout au stade
   « créées » signifie que la passerelle WhatsApp n'a rien pris en charge.

## Une alerte est partie par erreur

Une alerte publiée ne se rappelle pas. Ce qui reste possible :

1. Interrompre la diffusion depuis la fiche : l'alerte passe en annulée et ne
   peut plus repartir. Les livraisons déjà créées restent en l'état.
2. Consigner l'incident et prévenir les organisations concernées.

## Une organisation voit des données qui ne sont pas les siennes

Incident critique. Ne pas chercher à corriger la donnée.

1. Relever l'écran, l'organisation et le compte.
2. `pnpm convex:test:permissions` : la suite de non-fuite passe-t-elle toujours ?
3. `pnpm test:tools` : le noyau d'autorisation est-il encore traversé par toutes
   les fonctions publiques ?
4. Si un test échoue, il nomme la fonction. Si tous passent, le problème est
   dans l'attribution de rôle, pas dans le code : vérifier les affectations.

## Le déploiement est dégradé

1. `wouri doctor` : si l'accès échoue, c'est le déploiement, pas l'application.
2. Le tableau de bord Convex donne l'état réel du déploiement.
3. Revenir à une version antérieure du code puis redéployer, selon la procédure
   du runbook. Les migrations sont non destructives : un retour arrière ne perd
   pas de données.

## Ce qui n'est pas branché

La passerelle WhatsApp, l'ingestion météo en direct et la télémétrie externe ne
sont pas connectées. Une panne de ces briques ne peut donc pas être diagnostiquée
ici : elle se manifeste par des livraisons qui restent au stade « créées », ou
par une source qui ne se met pas à jour.
