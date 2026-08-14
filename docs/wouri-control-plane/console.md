# WOURI Console

La référence vit avec le code, dans le dépôt `wouri-console` :
`docs/architecture.md`, `docs/permissions.md`, `docs/routes.md`.

## En une phrase

Un seul produit multi-organisations dont le contenu se compose à partir des
capacités renvoyées par `session/me`. Il n'existe pas un tableau de bord par
partenaire : c'est le même code.

## Trois règles portées par l'interface

**Masquer n'est pas protéger.** Une entrée de menu absente ne prouve rien :
l'accès direct rend un refus explicite, et le backend refuse de toute façon.

**Aucun contrôle décoratif.** Toute entrée de navigation mène à un écran réel.
Un bouton qui ne fait rien décrédibilise l'ensemble ; c'est pourquoi le rejeu
comparatif est annoncé comme non branché plutôt que proposé.

**Aucun compteur trompeur.** Les listes sont plafonnées côté serveur : un
décompte issu d'une page pleine s'affiche `50+` avec son plafond, jamais comme un
total. La jauge de quota ne se trace que lorsque le décompte est exact.

## Actions sensibles

Publication d'alerte, annulation, consentement, promotion linguistique, bascule
de drapeau, activation de version : chacune passe par une confirmation qui
répond à quatre questions — ce qui va se passer, qui est concerné, quelle
portée, est-ce réversible.
