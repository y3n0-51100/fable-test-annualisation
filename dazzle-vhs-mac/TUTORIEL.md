# Tutoriel pas à pas — numériser une VHS sur Mac avec le Dazzle DVC100

Ce guide part de zéro : aucune connaissance en informatique n'est nécessaire.
Vous allez taper (ou plutôt copier-coller) des commandes dans une fenêtre
noire appelée le **Terminal**. C'est impressionnant la première fois, mais
chaque commande est décrite, avec ce que vous devez voir apparaître.

**Temps à prévoir :** environ 30 minutes de préparation, une seule fois.
Ensuite, numériser une cassette prendra la durée de la cassette (une cassette
de 2 h se numérise en 2 h : c'est le magnétoscope qui donne le rythme).

**Ce qu'il vous faut :**

- votre Mac,
- le boîtier Dazzle DVC100,
- un magnétoscope VHS et une cassette,
- les câbles RCA (les 3 fiches **jaune / blanc / rouge**),
- une connexion internet.

---

## Sommaire

1. [Ouvrir le Terminal](#etape-1--ouvrir-le-terminal)
2. [Installer les outils de développement Apple](#etape-2--installer-les-outils-de-developpement-apple)
3. [Installer Homebrew](#etape-3--installer-homebrew)
4. [Installer libusb et ffmpeg](#etape-4--installer-libusb-et-ffmpeg)
5. [Récupérer le programme](#etape-5--recuperer-le-programme)
6. [Construire le programme](#etape-6--construire-le-programme)
7. [Brancher le matériel](#etape-7--brancher-le-materiel)
8. [Le test de diagnostic (important)](#etape-8--le-test-de-diagnostic-important)
9. [Lancer l'application et enregistrer](#etape-9--lancer-lapplication-et-enregistrer)
9 bis. [Enregistrer sans l'application](#etape-9-bis--enregistrer-sans-lapplication)
10. [Retrouver et lire le fichier](#etape-10--retrouver-et-lire-le-fichier)
11. [Si ça ne marche pas](#si-ca-ne-marche-pas)
12. [Les fois suivantes](#les-fois-suivantes)

---

## Trois réflexes avant de commencer

- **Copier-coller** : sélectionnez la commande dans ce document, `Cmd+C`,
  cliquez dans le Terminal, `Cmd+V`, puis appuyez sur **Entrée**. Ne retapez
  pas à la main, une faute de frappe suffit à tout bloquer.
- **Une commande = une ligne + Entrée.** Tant que vous n'appuyez pas sur
  Entrée, il ne se passe rien.
- **Si on vous demande votre mot de passe** : tapez celui de votre session
  Mac. **Rien ne s'affiche pendant que vous tapez**, pas même des étoiles.
  C'est normal. Tapez, puis Entrée.

---

## Étape 1 — Ouvrir le Terminal

1. Appuyez sur `Cmd + Espace` (la touche Commande et la barre d'espace).
2. Tapez `terminal`.
3. Appuyez sur **Entrée**.

Une fenêtre s'ouvre avec du texte du genre :

```
MacBook-de-Remi:~ remi$
```

C'est votre **invite de commande** : le Mac attend vos instructions. Gardez
cette fenêtre ouverte pendant tout le tutoriel.

---

## Étape 2 — Installer les outils de développement Apple

Ce sont les outils gratuits d'Apple qui permettent de fabriquer un programme
à partir de son code source. Copiez-collez :

```bash
xcode-select --install
```

- Une fenêtre s'ouvre et propose **« Installer »** → cliquez dessus, acceptez
  les conditions, et laissez faire (5 à 10 minutes selon votre connexion).
- Si vous voyez à la place le message `command line tools are already
  installed`, c'est déjà fait : passez à l'étape suivante.

---

## Étape 3 — Installer Homebrew

Homebrew est le « magasin d'applications » du Terminal ; il servira à
installer deux briques dont le programme a besoin. Copiez-collez cette ligne
(elle est longue, prenez-la en entier) :

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- Le programme vous demande de confirmer : appuyez sur **Entrée**.
- Il demande votre **mot de passe de session** : tapez-le (rien ne s'affiche)
  puis Entrée.
- Comptez 5 à 15 minutes.

### Puis une ligne indispensable (Mac Apple Silicon, M1/M2/M3/M4)

À la fin, Homebrew affiche un encadré « Next steps » avec deux lignes à
exécuter. Si vous ne savez pas quoi en faire, copiez-collez simplement ces
deux commandes, elles fonctionnent dans tous les cas :

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

> Sur un Mac Intel (avant 2020), ces lignes affichent une erreur
> « no such file or directory » : ce n'est pas grave, Homebrew s'installe
> ailleurs et fonctionne déjà. Continuez.

**Vérification** — tapez :

```bash
brew --version
```

Vous devez voir quelque chose comme `Homebrew 4.x.x`. Si vous voyez
`command not found`, fermez complètement la fenêtre du Terminal, rouvrez-la
(étape 1) et réessayez.

---

## Étape 4 — Installer libusb et ffmpeg

- **libusb** permet au programme de parler au boîtier Dazzle.
- **ffmpeg** transforme les images brutes en fichier vidéo lisible partout.

```bash
brew install libusb ffmpeg
```

Comptez 5 à 10 minutes (ffmpeg est volumineux). Beaucoup de texte défile,
c'est normal. Vous êtes bon quand l'invite (`$`) revient.

---

## Étape 5 — Récupérer le programme

### Solution simple : télécharger le dossier

1. Dans votre navigateur, ouvrez :
   <https://github.com/y3n0-51100/fable-test-annualisation/tree/claude/dazzle-vhs-mac-app-x1h2ie>
2. Bouton vert **« Code »** → **« Download ZIP »**.
3. Le fichier arrive dans **Téléchargements**. Double-cliquez dessus pour le
   décompresser : vous obtenez un dossier, et **dedans** un dossier
   `dazzle-vhs-mac`.

Maintenant, il faut « emmener » le Terminal dans ce dossier. Astuce qui évite
toute faute de frappe :

1. Dans le Terminal, tapez `cd ` (les lettres c, d, **puis un espace**) —
   sans appuyer sur Entrée.
2. Depuis le Finder, **glissez-déposez le dossier `dazzle-vhs-mac`** dans la
   fenêtre du Terminal. Son chemin s'écrit tout seul.
3. Appuyez sur **Entrée**.

**Vérification** — tapez :

```bash
ls
```

Vous devez voir apparaître :

```
Makefile   README.md   TUTORIEL.md   app   scripts   src
```

Si oui, vous êtes au bon endroit. Sinon, refaites le glisser-déposer.

### Variante pour les curieux : avec git

```bash
cd ~
git clone -b claude/dazzle-vhs-mac-app-x1h2ie https://github.com/y3n0-51100/fable-test-annualisation.git
cd fable-test-annualisation/dazzle-vhs-mac
```

---

## Étape 6 — Construire le programme

Il y a **deux constructions**, indépendantes l'une de l'autre. Faites-les
l'une après l'autre, pas en même temps.

### 6a. Le pilote (indispensable)

```bash
make
```

À la fin vous devez lire :

```
==> build/dvc100 construit. Testez : build/dvc100 probe
```

C'est le morceau important : il contient tout ce qui parle au boîtier. Même
si l'étape suivante échoue, vous pouvez **déjà numériser vos cassettes** avec
`scripts/record.sh` (voir l'étape 9 bis).

### 6b. L'application graphique (confort)

```bash
make app
```

À la fin :

```
==> build/VHSRecorder.app construit. Ouvrez-le avec : open build/VHSRecorder.app
```

Si un message d'erreur apparaît, lancez :

```bash
make doctor
```

et **envoyez-moi ce qu'il affiche** : ce rapport dit exactement quelle brique
manque sur votre Mac. Pendant ce temps, l'étape 9 bis vous permet d'enregistrer
sans l'application.

---

## Étape 7 — Brancher le matériel

1. Branchez le **boîtier Dazzle sur un port USB du Mac**, directement — pas
   sur un hub, pas sur un écran, pas sur un clavier. (Sur un Mac récent sans
   port USB-A rectangulaire, il vous faut un adaptateur USB-C → USB-A.)
2. Reliez les câbles entre le **magnétoscope** et le **boîtier** :

   | Fiche | Sur le magnétoscope | Sur le boîtier |
   |---|---|---|
   | **Jaune** | sortie vidéo (VIDEO OUT) | entrée vidéo jaune |
   | **Blanc** | sortie audio gauche (AUDIO L) | entrée audio blanche |
   | **Rouge** | sortie audio droite (AUDIO R) | entrée audio rouge |

   Attention : côté magnétoscope il faut les prises **OUT / SORTIE**, pas
   IN / ENTRÉE.
3. Mettez une cassette dans le magnétoscope et appuyez sur **Lecture**.
   Beaucoup de magnétoscopes n'envoient **aucun signal** à l'arrêt : il faut
   vraiment que la bande défile pour voir une image.

---

## Étape 8 — Le test de diagnostic (important)

Cette commande ne change rien sur votre Mac : elle interroge le boîtier et
raconte ce qu'elle trouve.

```bash
build/dvc100 probe
```

Vous obtiendrez un rapport de ce genre :

```
Peripherique      : 2304:021a (Pinnacle/Dazzle DVC100)
Bus/adresse       : 1/7
Interface video   : 0, alt 7, endpoint 0x82, 3072 o/paquet
Chip ID (R0A)     : 0x33 (EM2860)
Audio USB Class   : oui - le son doit apparaitre comme entree audio macOS
...
Decodeur          : 0x4a, version 0x01, statut 0x??
  signal video    : detecte
```

**Faites ceci, s'il vous plaît :** sélectionnez tout ce que la commande a
affiché, `Cmd+C`, et **envoyez-le moi**. Le DVC100 a existé en plusieurs
versions légèrement différentes, et ce rapport me dit précisément quels
réglages figer pour la vôtre. C'est cinq minutes de mise au point qui vous
éviteront de tâtonner.

En attendant, continuez : il y a de bonnes chances que ça marche du premier
coup.

---

## Étape 9 — Lancer l'application et enregistrer

```bash
open build/VHSRecorder.app
```

### Si macOS refuse de l'ouvrir

C'est normal : l'application vient de vous, pas de l'App Store, donc macOS
se méfie. Deux solutions :

- Dans le **Finder**, allez dans le dossier `build`, **clic droit** sur
  `VHSRecorder` → **Ouvrir** → **Ouvrir** dans la fenêtre d'avertissement.
  (Ce n'est à faire qu'une seule fois.)
- Ou, dans le Terminal :
  ```bash
  xattr -dr com.apple.quarantine build/VHSRecorder.app
  ```
  puis relancez `open build/VHSRecorder.app`.

### Dans l'application

1. **Norme** : choisissez **PAL** (cassettes européennes courantes). Si
   l'image apparaît en noir et blanc, revenez ici et essayez **SECAM**.
2. **Entrée** : laissez **Composite (RCA jaune)**.
3. **Audio** : choisissez l'entrée qui correspond au boîtier (souvent nommée
   « USB audio », « EM2860 » ou similaire). Si la liste est vide, cliquez sur
   **Rechercher les entrées audio**. Si le boîtier n'y est pas, choisissez
   « Aucun » pour l'instant et lisez la section son du `README.md`.
4. Cliquez sur **Démarrer l'aperçu**, magnétoscope en **Lecture**.
   → L'image de votre cassette doit apparaître dans la grande zone noire.
   La première fois, macOS demandera l'autorisation d'accéder au micro
   (c'est l'entrée audio) : cliquez sur **Autoriser**.
5. **Durée** : si vous savez que la cassette dure 3 heures, choisissez
   « 3 heures » (ou « Durée personnalisée » pour saisir un nombre de minutes).
   L'enregistrement s'arrêtera **tout seul** à l'heure dite, le fichier sera
   refermé proprement, et le Mac est empêché de s'endormir pendant ce
   temps-là : vous pouvez lancer la cassette et partir. Laissez « Sans
   limite » si vous préférez arrêter à la main.
6. Rembobinez au début de ce que vous voulez garder, mettez en lecture, puis
   cliquez sur **Enregistrer**. Le point devient rouge, le chronomètre démarre
   et, si vous avez fixé une durée, le temps restant s'affiche à côté.
7. À la fin, cliquez sur **Arrêter l'enregistrement** — ou ne faites rien si
   vous avez fixé une durée. **Attendez quelques secondes** : le fichier se
   finalise à ce moment-là.

> **À propos de la veille.** L'application empêche déjà le Mac de s'endormir
> tant qu'un enregistrement est en cours. Deux réserves : ne **rabattez pas
> l'écran** d'un MacBook (ça endort la machine quoi qu'il arrive), et laissez-le
> branché sur secteur pour une cassette de 3 heures. L'écran, lui, peut
> s'éteindre sans gêner l'enregistrement.
>
> En ligne de commande (étape 9 bis), utilisez `caffeinate -i` devant la
> commande, par exemple `caffeinate -i scripts/record.sh -d 10800 cassette.mp4`.

---

## Étape 9 bis — Enregistrer sans l'application

Si `make app` a échoué, ou simplement si vous préférez, une seule commande
suffit — le pilote fait tout le travail, l'application n'était qu'un confort :

```bash
scripts/record.sh ma-cassette.mp4
```

Mettez le magnétoscope en lecture **avant** de lancer la commande. Elle
enregistre jusqu'à ce que vous appuyiez sur **`Ctrl+C`** (la touche Contrôle,
pas Commande). Le fichier `ma-cassette.mp4` apparaît dans le dossier courant.

Quelques variantes utiles :

```bash
# Cassette SECAM (si les couleurs manquent en PAL)
scripts/record.sh -s secam ma-cassette.mp4

# Avec le son : trouvez d'abord le numéro de l'entrée audio
ffmpeg -f avfoundation -list_devices true -i ""
# puis, si le boîtier est par exemple le n°1 :
scripts/record.sh -a 1 ma-cassette.mp4

# Arrêt automatique au bout de 2 h (7200 secondes), sans surveiller
scripts/record.sh -d 7200 ma-cassette.mp4
```

Pendant l'enregistrement, une ligne de statistiques défile : tant que le
nombre de trames augmente, tout va bien.

---

## Étape 10 — Retrouver et lire le fichier

Le fichier s'appelle `Cassette_2026-07-29_15-42-10.mp4` (date et heure) et se
trouve par défaut dans votre dossier **Séquences** (`Movies`). Le bouton
**« Afficher le fichier dans le Finder »**, dans l'application, vous y emmène
directement.

Double-cliquez : il s'ouvre dans QuickTime. C'est un MP4 standard, lisible
sur n'importe quel appareil, importable dans iMovie, transférable sur une clé
USB, etc.

Pour changer de dossier de destination, utilisez le bouton **« Dossier… »**
dans l'application.

---

## Si ça ne marche pas

Reprenez ces points dans l'ordre — les trois premiers résolvent la grande
majorité des cas.

| Ce que vous voyez | Ce qu'il faut faire |
|---|---|
| **L'image reste noire** | Le magnétoscope est-il vraiment en **Lecture** (bande qui défile) ? La fiche **jaune** est-elle sur la sortie **OUT** du magnétoscope ? |
| **Image en noir et blanc** | Mauvaise norme couleur : dans l'app, passez de **PAL** à **SECAM** (ou l'inverse). |
| **`error: 'app': Invalid manifest` / `no such module 'PackageDescription'`** | Chaîne d'outils Swift incomplète. La version actuelle du projet n'utilise plus Swift Package Manager : re-téléchargez le dossier (étape 5) et relancez `make app`. |
| **« Outil dvc100 introuvable »** | L'app a été lancée sans avoir été construite : refaites l'étape 6. |
| **« ffmpeg introuvable »** | Refaites l'étape 4 : `brew install ffmpeg`. |
| **« aucun boîtier EM28xx reconnu »** | Le boîtier n'est pas branché, ou son identifiant est inconnu. Tapez `system_profiler SPUSBDataType \| grep -i -A 6 dazzle` et envoyez-moi le résultat. |
| **Image saccadée** | Branchez le boîtier directement sur le Mac (sans hub), et fermez les applications lourdes. |
| **La liste « Audio » est vide** | macOS n'a pas donné l'autorisation micro : Réglages Système → Confidentialité et sécurité → **Microphone** → activez VHS Recorder, puis cliquez sur « Rechercher les entrées audio ». Si elle reste vide, lancez `build/dvc100 probe` et regardez la ligne **« Audio USB Class »** : si elle dit `non`, votre boîtier n'expose pas son son à macOS — voir la section « Le son » du `README.md` pour les solutions. |
| **Le son est absent ou grésille** | Vérifiez l'entrée choisie dans « Audio », que les fiches rouge et blanche sont bien enfoncées côté **OUT** du magnétoscope, et que le niveau bouge dans Réglages Système → Son → Entrée pendant la lecture. |
| **Autre chose** | Dans l'app, cliquez sur **Journal** en bas à droite de l'image : copiez les dernières lignes et envoyez-les moi. |

---

## Les fois suivantes

Toute l'installation est faite une fois pour toutes. Pour numériser une
nouvelle cassette :

1. Ouvrez le Terminal (`Cmd + Espace`, `terminal`, Entrée).
2. Retournez dans le dossier — glisser-déposer, ou si vous avez utilisé git :
   ```bash
   cd ~/fable-test-annualisation/dazzle-vhs-mac
   ```
3. ```bash
   open build/VHSRecorder.app
   ```

Et si un jour vous préférez tout faire en une seule commande, sans
l'application :

```bash
scripts/record.sh mariage-1998.mp4
```

(`Ctrl+C` pour arrêter l'enregistrement — c'est la touche Contrôle, pas
Commande.)
