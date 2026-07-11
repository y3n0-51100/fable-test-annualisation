# Suivi Annualisation

Application web de **gestion de l'annualisation du temps de travail** pour un
magasin de vente au détail (France) : suivi des heures vs cible annuelle
(1607 h non-cadres / 218 jours cadres), demandes d'absence avec validation
manager, prêt de la camionnette, alertes de dérive, documents RH et acomptes
sur salaire avec signature électronique.

- **100 % statique** : aucun serveur applicatif à maintenir — HTML/CSS/JS
  vanilla, hébergeable sur GitHub Pages ou Firebase Hosting.
- **Backend** : Firebase (Firestore + Authentication), configuré par
  placeholders. Tant que Firebase n'est pas configuré, l'app démarre en
  **mode démo** (données locales au navigateur) pour être testée immédiatement.
- **Entièrement en français**, mode sombre, responsive, raccourcis clavier.

## Démarrage rapide (mode démo)

Servez le dossier avec n'importe quel serveur statique et ouvrez l'app :

```bash
npx serve .        # ou : python3 -m http.server 8000
```

Connectez-vous avec **`admin` / `admin123`**. Les données restent dans le
navigateur (localStorage) — parfait pour évaluer l'outil, à ne pas utiliser
en production.

## Configuration production

### 1. Firebase

1. Créez un projet sur [console.firebase.google.com](https://console.firebase.google.com).
2. Activez **Firestore** (mode production) et **Authentication → E-mail/Mot de passe**.
3. Ajoutez une application Web et copiez la configuration dans `js/config.js`
   (remplacez chaque `"À_CONFIGURER"` de `FIREBASE_CONFIG`).
4. Déployez les règles de sécurité : copiez le contenu de `firestore.rules`
   dans *Firestore → Règles* (ou `firebase deploy --only firestore:rules`).

> La clé `apiKey` Firebase n'est **pas un secret** (elle identifie le projet
> côté client) : la sécurité repose sur Firebase Authentication et les règles
> Firestore.

#### Identifiants de connexion

Les collaborateurs se connectent avec un **identifiant court** (ex. `jdupont`),
transformé en e-mail technique `jdupont@<AUTH_EMAIL_DOMAIN>` (constante dans
`js/config.js`). Vous pouvez changer ce domaine — il n'a pas besoin d'exister,
il sert uniquement d'espace de noms pour Firebase Authentication.

#### Créer le premier compte admin

1. Dans **Firebase Authentication → Users → Add user** : créez
   `admin@<AUTH_EMAIL_DOMAIN>` avec un mot de passe fort.
2. Dans **Firestore**, créez le document `users/admin` :

```json
{
  "id": "admin", "name": "Prénom Nom", "username": "admin",
  "role": "admin", "email": "vous@exemple.fr", "matricule": "",
  "isCadre": false, "hoursTarget": 1607, "daysTarget": 218,
  "cpDays": 25, "cpAnciennete": 0,
  "typePlanning": { "lundi": 7, "mardi": 7, "mercredi": 7, "jeudi": 7, "vendredi": 7, "samedi": 0, "dimanche": 0 }
}
```

3. Connectez-vous : les comptes suivants se créent depuis **Gestion Équipe**
   (l'app crée le compte Authentication et la fiche Firestore en une fois).

> Limites du client Firebase (assumées pour rester sans serveur) : l'admin ne
> peut pas changer le mot de passe d'un autre compte ni supprimer son compte
> Authentication depuis l'app — ces deux opérations se font dans la console
> Firebase (la fiche et le planning sont, eux, bien supprimés par l'app).

### 2. EmailJS (notifications par e-mail)

1. Créez un compte sur [emailjs.com](https://www.emailjs.com), ajoutez un
   service e-mail, puis **4 modèles** et reportez les IDs dans `js/config.js`
   (`EMAILJS_CONFIG`), ainsi que `MANAGER_EMAIL` et `APP_URL`.
2. Variables disponibles par modèle :

| Modèle | Usage | Variables |
|---|---|---|
| `absenceRequest` | nouvelle demande d'absence → manager | `to_email`, `user_name`, `request_type`, `request_dates`, `request_quantity`, `request_comment`, `app_url` |
| `vanRequest` | nouvelle demande camionnette → manager | `to_email`, `user_name`, `request_dates`, `request_parking`, `request_comment`, `app_url` |
| `requestResponse` | décision → collaborateur | `to_email`, `user_name`, `request_type`, `request_dates`, `decision`, `app_url` |
| `adminDigest` | récapitulatif quotidien → manager | `to_email`, `pending_absences`, `pending_vans`, `critical_count`, `warning_count`, `critical_list`, `app_url` |

Si EmailJS n'est pas configuré, l'application fonctionne normalement et
affiche simplement un avertissement non bloquant au lieu d'envoyer l'e-mail.

### 3. Déploiement

**GitHub Pages** : poussez le dépôt, puis *Settings → Pages → Deploy from
branch*. **Firebase Hosting** : `firebase init hosting` (dossier public : `.`)
puis `firebase deploy`.

## Structure du projet

```
index.html            Point d'entrée (shell + CDN des bibliothèques)
css/styles.css        Design system (navy/orange/teal, mode sombre, print)
js/config.js          ← SEUL fichier à modifier pour configurer l'app
js/core.js            Logique métier PURE (calculs, alertes) — testable sans UI
js/data.js            Couche de données (Firestore ou mode démo localStorage)
js/ui.js              Toasts, modales, thème, helpers
js/main.js            État global, navigation, authentification, annonces
js/pages-employee.js  Pages collaborateur + éditeur de planning partagé
js/pages-admin.js     Pages administrateur
js/pages-docs.js      Documents RH + acomptes (signatures, PDF)
firestore.rules       Règles de sécurité Firestore commentées
tests/test-core.js    Tests du cœur métier :  node tests/test-core.js
```

## Sécurité

- **Aucun mot de passe stocké ou comparé en clair** : en production,
  l'authentification est déléguée à **Firebase Authentication** ; en mode
  démo local, les mots de passe sont hachés (SHA-256 + sel) via WebCrypto.
- **Règles Firestore strictes** (`firestore.rules`) : chaque collaborateur ne
  peut écrire que son planning et ses demandes ; documents et acomptes sont
  cloisonnés par utilisateur ; le journal d'audit est en ajout seul.
- **Actions destructives** (restauration de sauvegarde, ALL RESET,
  suppression de collaborateur) protégées par saisie d'un mot de confirmation
  (`RESTAURER` / `SUPPRIMER`), compte à rebours annulable pour le reset, et
  journalisation systématique.
- Tout contenu saisi est échappé avant insertion dans le DOM (anti-XSS).

## Tests

```bash
node tests/test-core.js   # 50 assertions sur la logique métier pure
```

## Choix d'implémentation

Les points laissés ouverts par le cahier des charges et les arbitrages
correspondants sont documentés dans
[`CHOIX_IMPLEMENTATION.md`](CHOIX_IMPLEMENTATION.md).
