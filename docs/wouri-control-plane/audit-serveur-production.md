# Audit du serveur de production WOURI

**Date** 14 août 2026 · **Serveur** `serveur.africandigitconsulting.com`
(`vmi3499821`, 169.58.156.206) · **Accès** compte `marcel`, clé ECDSA autorisée
par Issouf · **Périmètre** lecture, plus les corrections de configuration sans
risque de coupure.

Chaque affirmation porte la commande qui la produit, pour qu'elle soit rejouable.

---

## 1. Ce qui fonctionne

**WOURI répond en production, aujourd'hui.** Ce n'est pas une déduction, c'est
dans les journaux. À 13 h 56 UTC, un message vocal réel a traversé toute la
chaîne :

```
docker logs --tail 25 $(docker ps -q --filter name=whatsappserver)
```

```
[AUDIO] Message vocal reçu           5115 octets
[AUDIO] mode both -> ASR Bambara
[ASR-BAMBARA] Transcription           « ani sɔ ma wuuri ne pɛfɛ ka kaba sɛnɛ »
[MESSAGE] Étape                       complete
[API] Appel                           ville Bouaké, langue both, voiceInput true
[ENVOYE] Texte FR
[ENVOYE] Audio dioula
```

Réception, reconnaissance vocale, appel de l'API, réponse texte française et
réponse audio dioula. Le parcours agriculteur existe et tourne.

**Les quatre services sont sains et stables.** `wourri-wouriapi` (11 h,
*healthy*), `wourri-whatsappserver` (13 h, *healthy*), `wourri-postgres` (14 h),
plus la pile Dokploy, Traefik et Portainer. L'API répond `200` sur `/health`,
`/` et `/docs`.

**Le CORS est correctement fermé en production.** J'avais relevé
`ALLOWED_ORIGINS` vide et je m'en méfiais : vérification faite, c'est un faux
problème. Le middleware permissif est conditionné dans `app/main.py:230` :

```python
if not settings.is_production:
    app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)
```

En production il n'est pas monté du tout. La variable est résiduelle, pas une
ouverture. Une limitation à dix requêtes par minute et par IP est par ailleurs
active (`slowapi`).

**SSH est durci.** `PasswordAuthentication no`, `MaxAuthTries 3`, connexion par
clé uniquement, trois clés autorisées et identifiées. `fail2ban` est actif — et
je l'ai vérifié à mes dépens : mes propres sondages de ports m'ont fait bannir
temporairement. La protection fonctionne.

**Les sauvegardes existent et sont bien pensées.** Dump Postgres, session
WhatsApp et données WA, rétention 30 jours, mot de passe lu dans l'environnement
du conteneur et jamais écrit dans le script. Le fichier du jour passe le test
d'intégrité gzip.

**Le pare-feu tient.** Depuis l'extérieur, seul le port 22 répond ; 2377, 5432 et
9443 sont filtrés. Les domaines `dokploy.` et `portainer.` répondent en HTTPS.

---

## 2. Écarts, par gravité

### Élevé — Les sauvegardes ne quittent jamais la machine

Le script le dit lui-même en commentaire : « backups locaux dans
`~/wourri-backups` (même disque — pour de l'off-site, brancher un rclone/S3 plus
tard) ». Si le disque ou la VM disparaît, les données **et** leurs sauvegardes
disparaissent ensemble. C'est le point de défaillance unique classique.

S'y ajoute que **la restauration n'a jamais été testée**. Une sauvegarde dont on
n'a pas prouvé qu'elle se restaure n'est pas une sauvegarde, c'est un fichier.

### Élevé — L'automatisation des sauvegardes n'est pas prouvée

```
crontab -l          → 15 2 * * * /home/marcel/wourri-backup.sh >> .../backup.log
ls ~/wourri-backups → db_2026-08-14_0237.sql.gz  (une seule génération)
ls .../backup.log   → No such file or directory
```

Le cron est planifié à 02 h 15, les fichiers datent de 02 h 37, et le journal
n'existe pas. Le cron n'a donc jamais produit de sortie : la sauvegarde présente
a été lancée à la main. L'explication la plus probable est que tout a été mis en
place ce matin et que la première exécution automatique aura lieu demain. **À
confirmer le 15 au matin** : c'est vérifiable en une commande.

### Moyen — Tous les services partagent un seul réseau, y compris le plan de contrôle

```
docker network inspect dokploy-network --format '{{range .Containers}}{{println .Name}}{{end}}'
```

```
dokploy          dokploy-postgres    dokploy-traefik    portainer
wourri-wouriapi  wourri-postgres     wourri-whatsappserver
```

L'API WOURI, qui traite des entrées venues de l'extérieur et appelle un modèle de
langue, se trouve sur le même réseau que la base de données de Dokploy et que
Portainer. Une compromission de l'API donne accès au plan de déploiement, pas
seulement aux données métier.

Les fichiers `docker-compose.prod.yml` et `docker-compose.staging.yml` prévoient
pourtant des réseaux dédiés (`wourri_net`, `wourri_staging_net`) : ils n'ont pas
été appliqués.

### Moyen — Portainer est publiquement exposé sans nécessité

`portainer.africandigitconsulting.com` répond `200`. Portainer permet de lire les
variables d'environnement de n'importe quel conteneur, donc `DEEPSEEK_API_KEY`,
`API_SECRET_KEY`, `POSTGRES_URL` et `PII_SALT`. Dokploy administre déjà la pile :
c'est une seconde porte d'administration publique dont personne n'a besoin.

Le sel PII mérite une mention particulière. Il rend non réversible le hachage des
numéros de téléphone des agriculteurs. Un numéro ivoirien a peu d'entropie :
qui obtient le sel peut retrouver les numéros par force brute à partir des
hachages. **Vérifié : cette valeur n'est pas dans Git** (`git log --all -S`), le
risque vient uniquement de l'exposition de Portainer.

### Moyen — Un seul environnement, INF-06 non fait

Il n'existe ni `wouri-staging` ni `wouri-production` : un seul jeu de conteneurs,
étiqueté `ENV=production`. La base s'appelle bien `wourri_prod`, donc une partie
de la spécification a été suivie, mais les deux projets Dokploy séparés n'existent
pas.

À noter : la spécification INF-06 que j'avais écrite
(`docs/wouri/dokploy-environments.md`) **n'a jamais été fusionnée** dans `APIPy`.
Elle vit sur la branche `feat/372-convex-foundation`. Issouf a donc déployé sans
l'avoir sous la main, ce qui n'est pas de sa responsabilité.

### Moyen — La traduction dioula produit du texte incohérent

Dans le parcours réussi de 13 h 56, la traduction intermédiaire est cassée :

```
transcription : « ani sɔ ma wuuri ne pɛfɛ ka kaba sɛnɛ »
traduction    : « Ainsi que haricot PFV NEG wuuri pɛfɛ cultiver du m... »
NLU           : « Quelle est la meilleure saison pour planter du maïs ? »
```

La question a été correctement comprise, mais **par un autre chemin** que la
traduction, marqué `Message NLU (prioritaire)`. Deux conséquences.

D'abord, le journal affiche `Transcription Bambara réussie !` alors que la
traduction est inexploitable : le système se déclare en succès sur une sortie
fausse. Ensuite, cela recoupe le risque déjà signalé à Issouf sur les poids
manquants de l'adaptateur dioula : la chaîne bascule silencieusement sur le
modèle générique bambara malien, et rien ne le signale.

### Faible — `PermitRootLogin yes` subsiste dans le fichier principal

```
/etc/ssh/sshd_config                        → PermitRootLogin yes
/etc/ssh/sshd_config.d/00-adc-hardening.conf → PermitRootLogin no
/etc/ssh/sshd_config.d/10-adc-security.conf  → PermitRootLogin no
```

L'`Include` est en ligne 12 et OpenSSH retient la **première** valeur lue : les
fichiers `.d` gagnent, la connexion root est donc bien refusée. Mais la ligne
`yes` reste un piège : déplacer l'`Include` plus bas la réactiverait sans que
personne ne s'en aperçoive.

### Faible — 20 Go d'image inutilisée

`wourri-integration-test:latest` occupe 20,3 Go affichés, construite ce matin,
rattachée à aucun conteneur. Le disque est à 54 % (134 Go libres), ce n'est donc
pas urgent, mais c'est de la place récupérable immédiatement.

---

## 3. Correction appliquée

Une seule entrait dans le périmètre autorisé.

**Les sauvegardes étaient lisibles par tout le monde.** Répertoire en `775`, dump
de base en `664`, archive de session WhatsApp en `644`. N'importe quel utilisateur
local pouvait lire la base entière et voler la session WhatsApp.

```
chmod 700 ~/wourri-backups
chmod 600 ~/wourri-backups/db_*.sql.gz
```

Résultat vérifié : répertoire `700`, dump `600`, intégrité gzip toujours bonne
pour le propriétaire. Les deux archives appartenant à `root` restent en `644`
— je ne peux pas les modifier — mais le répertoire en `700` empêche désormais
tout non-root d'y accéder.

**Aucun service n'a été redémarré.** `wourri-whatsappserver` affiche toujours
« Up 13 hours » après la correction : la session appairée est intacte.

Portée réelle : seuls `root`, `sync` et `marcel` peuvent ouvrir une session sur
la machine. Le risque était donc modéré, mais la correction est gratuite et
réversible.

---

## 4. État réel des portes de validation

| Porte | État | Ce qui manque |
| --- | --- | --- |
| **G01** Infrastructure prête | **Presque** | Serveur, Dokploy, TLS, sauvegardes : présents. Manquent la copie hors serveur et un test de restauration |
| **G02** Staging et production isolés | **Non** | Un seul environnement, un seul réseau partagé avec le plan de contrôle |
| **G05** WhatsApp de bout en bout | **Oui, par session sortante** | Le flux fonctionne réellement. Il n'y a pas de webhook Meta, donc pas de dépendance à une vérification Meta |
| **G14** Sécurité et reprise | **Partielle** | Permissions, opt-out et audit acquis côté Convex. Restauration jamais testée, pas de copie externe |

**G05 mérite d'être soulignée.** Je la donnais bloquée par l'absence de route
Traefik. C'est faux : le serveur WhatsApp maintient une session sortante, sans
aucune entrée publique à ouvrir. La porte est démontrable dès maintenant, avec un
téléphone.

---

## 5. Options pour le 17 août

Tu n'as pas encore décidé où se joue la démonstration. Voici ce qui est possible
avec ce qui existe aujourd'hui.

### Option A — Console sur Convex, plus un parcours WhatsApp réel

**Coût : nul, c'est déjà en place.** Tu montres la Console pour le pilotage
institutionnel et tu envoies un vrai message WhatsApp depuis un téléphone pour
montrer le parcours agriculteur. Les deux fonctionnent aujourd'hui, séparément et
sans rien déployer.

C'est ma recommandation. Elle couvre G03, G04, G05, G06, G09, G11 et G13, et ne
demande aucune intervention sur le serveur avant la restitution.

### Option B — Ajouter une adresse publique pour l'API

**Coût : environ une heure, Issouf.** Créer une entrée Traefik vers l'API, avec
un certificat. Utile seulement si tu veux montrer la documentation interactive
`/docs` ou brancher une démonstration web.

Attention : cela ouvre publiquement une API qui n'a aujourd'hui aucun CORS
configuré et une limitation de débit unique à dix requêtes par minute. À ne faire
que si le besoin est réel.

### Option C — Séparer staging et production, INF-06

**Coût : une demi-journée, Issouf, plus un risque de coupure.** C'est la seule
façon de fermer G02. À trois jours de la restitution, sur le serveur qui fait
tourner la démonstration, je le déconseille : mieux vaut présenter G02 comme
planifiée après le 17, avec la spécification déjà écrite, que casser un
environnement qui fonctionne.

### Ce qu'il faut faire avant le 17, quel que soit ton choix

1. **Vérifier demain matin que le cron de sauvegarde a tourné.**
   `ls -l ~/wourri-backups/` doit montrer une génération datée du 15.
   *Cinq minutes, Marcel.*
2. **Tester une restauration** dans une base jetable. Sans cela, G14 reste
   invérifiable. *Trente minutes, Issouf.*
3. **Fermer Portainer au public**, ou le restreindre par IP. Dokploy suffit.
   *Quinze minutes, Issouf.*

---

## 6. Ce que je ne peux pas trancher

**La configuration du pare-feu.** `ufw status` et `iptables -S` demandent les
droits root, et le compte `marcel` exige un mot de passe pour `sudo` — ce qui est
une bonne chose. J'ai contourné en sondant depuis l'extérieur, ce qui prouve que
les ports sensibles sont filtrés, mais ne dit pas comment. Une commande d'Issouf
suffirait : `sudo ufw status verbose`.

**Si le cron de sauvegarde fonctionne.** Réponse demain 02 h 15.

**La cause exacte de la traduction incohérente.** Cela demande de lire le code du
dépôt `wourri` et de vérifier la présence des poids de l'adaptateur dioula dans
l'image. Hors périmètre de cet audit, et déjà signalé à Issouf.

**L'écart de taille d'image.** Le commit #377 annonce une réduction de 19 à 5 Go ;
`docker images` en affiche 14. La mesure de `docker images` compte les couches
partagées, elle n'est donc pas comparable telle quelle. À vérifier autrement.

---

## 7. Ce que cet audit n'a pas fait

Il n'a pas créé les projets Dokploy séparés, ni déployé la WOURI Console, ni
modifié une ligne du dépôt `wourri`, ni testé une restauration de sauvegarde.
Ces quatre chantiers restent ouverts, avec leur propriétaire et leur coût
ci-dessus.
