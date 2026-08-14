# WOURI MCP

La référence complète vit avec le code : **[`tools/README.md`](../../tools/README.md)**.

## En une phrase

Onze outils de lecture et cinq ressources documentaires, sur stdio, pour qu'un
agent puisse diagnostiquer un incident sans jamais atteindre une écriture.

## Ce qu'un agent doit lire en premier

`wouri://policy` — ce qu'il peut et ne peut pas faire, et sur quel déploiement.
Un agent qui ne connaît ni les capacités ni la politique de risque finit par
inventer une action plausible.

## Pour une action sensible

Le MCP ne l'exécute pas. Il prépare : l'agent rassemble le constat et l'impact,
puis un humain décide depuis la Console, derrière une confirmation qui nomme
l'effet, les personnes concernées, la portée et la réversibilité (§64).

## Interdits

Publier une alerte, écrire à un agriculteur, modifier un consentement, activer
une version, basculer un drapeau, suspendre une organisation, lire un secret,
exporter des données personnelles. Il n'existe pas non plus d'outil générique du
type `execute_sql` ou `run_command` : les outils sont métier et bornés (§104).
