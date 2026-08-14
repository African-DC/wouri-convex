# Exploitation courante

Le runbook de déploiement, les variables d'environnement et les tests de fumée
sont dans **[`docs/convex-runbook.md`](../convex-runbook.md)**. Ce document ne
couvre que les gestes propres au Control Plane.

## Vérifier que l'outillage voit juste

```bash
pnpm test:tools          # politique d'accès et couverture de l'autorisation
pnpm registry:check      # la matrice de parité est-elle à jour ?
```

`registry:check` échoue si le document généré ne correspond plus au code. À
lancer avant toute revue : une matrice périmée est pire qu'aucune matrice.

## Après avoir ajouté une fonction publique

1. La classer dans `tools/registry/risk.mjs`. Sans cela le générateur échoue,
   volontairement : aucune surface n'entre sans décision de risque.
2. `node tools/registry/build.mjs` pour régénérer la matrice.
3. Vérifier qu'elle n'apparaît pas dans les **fonctions orphelines**. Une
   fonction que personne ne peut atteindre est soit un trou du Control Plane,
   soit une surface à retirer.

## Ouvrir un accès de démonstration

La création de compte est fermée par défaut. Pour ajouter un compte :

```bash
pnpm exec convex env set --prod AUTH_SELF_SIGNUP_ENABLED true
# créer le compte, puis le rattacher via internal.testing.linkDemoAccount
pnpm exec convex env set --prod AUTH_SELF_SIGNUP_ENABLED false
```

Refermer immédiatement. Un environnement de démonstration reste public.

## Couper une fonctionnalité

Depuis **Feature flags**, ou en réactivant une version antérieure depuis
**Prompts et modèles**. Les deux gestes sont immédiats, journalisés et
réversibles. Voir `production-safety.md`.
