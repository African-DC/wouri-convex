# WOURI CLI

La référence complète vit avec le code : **[`tools/README.md`](../../tools/README.md)**.
Elle y est maintenue avec les commandes, plutôt que recopiée ici où elle
divergerait au premier ajout.

## En une phrase

Diagnostic en lecture seule, déploiement explicite, sortie lisible par défaut et
`--json` pour un script, code de sortie exploitable.

```bash
node tools/cli/wouri.mjs doctor --deploiement staging
node tools/cli/wouri.mjs traces --statut failed --json
```

## Ce qu'elle ne fait pas

Aucune écriture. Ce n'est pas une convention mais une contrainte de code :
`tools/shared/client.mjs` refuse tout appel hors du préfixe de lecture seule, et
`tools/shared/policy.test.mjs` le vérifie en tentant réellement d'appeler une
mutation.
