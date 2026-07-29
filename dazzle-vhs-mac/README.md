# Dazzle DVC100 → Mac

Capture de cassettes VHS sur macOS avec un boîtier **Pinnacle/Dazzle DVC100**,
sans passer par Windows.

> **Vous débutez avec le Terminal ?** Ne lisez pas ce fichier : suivez
> **[TUTORIEL.md](TUTORIEL.md)**, qui reprend tout pas à pas, de l'ouverture du
> Terminal jusqu'au fichier vidéo, sans rien supposer connu.

---

## Pourquoi aucun logiciel ne fonctionne

Ce n'est pas un problème de logiciel, c'est un problème de **pilote**.

Le DVC100 n'est pas un périphérique « UVC » (la norme que macOS reconnaît
automatiquement, comme une webcam). C'est une puce **Empia EM2860** associée à
un décodeur vidéo analogique **Philips SAA711x**, qui parle un protocole USB
propriétaire. macOS n'a aucun pilote pour cette puce, donc le boîtier
n'apparaît nulle part : ni dans QuickTime, ni dans OBS, ni dans iMovie. Aucun
logiciel de capture ne peut le voir, quel qu'il soit. Seul Linux possède un
pilote pour cette famille de puces (`em28xx`), et Windows a celui de Pinnacle.

La seule vraie solution est donc d'**écrire le pilote**. C'est ce que contient
ce dossier : un pilote en espace utilisateur (pas d'extension noyau, rien à
installer dans le système) qui parle directement à la puce via libusb, plus une
petite application pour s'en servir.

---

## Ce que contient le projet

| Élément | Rôle |
|---|---|
| `src/` | Le pilote : accès aux registres du pont EM28xx, bus I2C, configuration du décodeur analogique, capture isochrone USB, réassemblage des trames entrelacées |
| `build/dvc100` | Outil en ligne de commande : `probe` (diagnostic) et `stream` (trames YUYV brutes) |
| `app/` | **VHS Recorder**, application macOS : aperçu en direct, bouton d'enregistrement, choix PAL/SECAM/NTSC, audio, qualité |
| `scripts/record.sh` | Enregistrement en une commande, sans l'application |

Le découpage est volontaire : `dvc100` ne fait *que* sortir les images brutes,
ffmpeg fait l'encodage. Rien ne peut bloquer le flux USB pendant qu'une
cassette défile.

---

## Installation

```bash
# 1. Dépendances (Homebrew)
brew install libusb ffmpeg

# 2. Compilation
cd dazzle-vhs-mac
make            # construit build/dvc100
make app        # construit en plus build/VHSRecorder.app
```

Il faut les outils en ligne de commande Xcode (`xcode-select --install`) pour
compiler, et Swift (fourni avec) pour l'application.

---

## Première étape : le diagnostic

**À faire avant tout le reste**, boîtier branché (le magnétoscope peut être
éteint) :

```bash
build/dvc100 probe
```

Vous obtiendrez l'identifiant USB, le modèle exact de la puce, l'état du
décodeur vidéo, le contenu des registres et le scan du bus I2C interne.

C'est le point important : le DVC100 a existé en **plusieurs révisions**
matérielles qui ne se câblent pas de la même façon. La partie « protocole de la
puce » du pilote est identique pour toutes, mais quelques valeurs dépendent de
la carte (quelle entrée analogique porte le composite, l'horloge utilisée, la
fenêtre de capture). Toutes ces valeurs sont réglables en ligne de commande
sans recompiler — voir « Dépannage » — et la sortie de `probe` dit lesquelles
ajuster. **Envoyez-moi cette sortie et j'ajuste les réglages pour votre
exemplaire.**

---

## Utilisation

### Avec l'application

```bash
open build/VHSRecorder.app
```

1. Branchez le boîtier, reliez la sortie vidéo (RCA jaune) du magnétoscope à
   l'entrée composite, et les RCA rouge/blanc à l'entrée audio.
2. Choisissez la norme (**PAL** pour la plupart des cassettes européennes,
   **SECAM** si les couleurs sont absentes en PAL, **NTSC** pour les cassettes
   américaines ou japonaises).
3. **Démarrer l'aperçu** → mettez le magnétoscope en lecture : l'image doit
   apparaître.
4. **Durée** (facultatif) : 30 min à 4 h, ou une valeur libre en minutes.
   L'enregistrement s'arrête alors seul, le fichier est refermé proprement et
   la veille du Mac est bloquée pendant toute la durée — de quoi lancer une
   cassette de 3 h et s'absenter. Le temps restant s'affiche sous l'image.
5. **Enregistrer** → un fichier `Cassette_<date>.mp4` est créé dans le dossier
   choisi (Séquences par défaut).

L'aperçu et l'enregistrement partagent le même flux : l'image affichée est
exactement celle qui est écrite dans le fichier.

### En ligne de commande

```bash
# Enregistrement simple (Ctrl-C pour arrêter)
scripts/record.sh ma-cassette.mp4

# SECAM, entrée audio n°1, arrêt automatique après 2 h
scripts/record.sh -s secam -a 1 -d 7200 vacances-1994.mp4

# Numéro de l'entrée audio
ffmpeg -f avfoundation -list_devices true -i ""
```

Ou en assemblant soi-même :

```bash
build/dvc100 stream --standard pal --stats | \
  ffmpeg -f rawvideo -pix_fmt yuyv422 -s 720x576 -r 25 -i - \
         -vf yadif=1 -c:v libx264 -crf 18 -preset slow cassette.mp4
```

### Le son

Contrairement à la vidéo, le son ne passe **pas** par ce pilote : sur la
plupart des révisions, le DVC100 expose son entrée audio comme un périphérique
**USB audio standard**, que macOS pilote tout seul. L'application se contente
alors de demander à ffmpeg d'enregistrer cette entrée.

**Trois vérifications, dans cet ordre :**

1. `build/dvc100 probe` → ligne **« Audio USB Class »**. C'est la réponse
   matérielle : `oui` signifie que macOS peut voir le son, `non` qu'il ne le
   pourra jamais, quel que soit le logiciel.
2. **Réglages Système → Son → Entrée** : le boîtier doit y figurer, sous un nom
   du genre « USB audio CODEC », « eMPIA » ou « Dazzle ». Mettez le
   magnétoscope en lecture : le niveau doit bouger.
3. Dans l'application, bouton **« Rechercher les entrées audio »**. La première
   fois, macOS demande l'autorisation d'accéder au micro — **il faut
   l'accepter**, sinon la liste reste vide. Si vous avez refusé par mégarde :
   Réglages Système → Confidentialité et sécurité → Microphone → activez
   VHS Recorder.

**Si l'audio USB n'existe pas sur votre exemplaire** (cas `non` en 1), le son
doit entrer dans le Mac par un autre chemin :

- un petit **adaptateur USB audio** avec entrée ligne ou micro (une dizaine
  d'euros) relié aux fiches rouge et blanche du magnétoscope — c'est la
  solution la plus simple ;
- l'**entrée ligne** du Mac, si le vôtre en a une (les modèles récents n'en ont
  plus, et la prise casque n'accepte qu'un micro, pas un niveau ligne) ;
- en dernier recours, enregistrer le son séparément et le recoller ensuite :
  `ffmpeg -i video.mp4 -i son.wav -c:v copy -c:a aac final.mp4`.

Dans tous les cas, l'entrée choisie apparaît dans la liste « Audio » de
l'application, et la vidéo s'enregistre parfaitement sans son si vous
choisissez « Aucun ».

### Qualité d'archivage

Les valeurs par défaut sont pensées pour de la VHS :

- **YUV 4:2:2 non compressé** jusqu'à l'encodeur (aucune perte avant H.264) ;
- **désentrelacement `yadif=1`** : la VHS est entrelacée à 50 demi-images/s, on
  obtient 50 images/s progressives, bien plus agréables à revoir ;
- **CRF 18 preset slow** : environ 3 à 5 Go par heure, différence invisible
  avec la source. Le mode « Archivage » (CRF 14) est plus gros et plus fidèle.

Une cassette de 3 h se capture en 3 h : c'est du temps réel, le magnétoscope
impose le rythme. Ne mettez pas le Mac en veille pendant ce temps
(`caffeinate -i scripts/record.sh …` évite l'endormissement).

---

## Dépannage

Le pilote est conçu pour être réglable sans recompiler. Dans l'ordre :

**« aucun boîtier EM28xx reconnu »**
Le boîtier n'est pas dans la table d'identifiants USB. Trouvez le sien avec
`system_profiler SPUSBDataType | grep -A 6 -i dazzle` puis forcez-le :
`build/dvc100 probe --vid 0x2304 --pid 0x021a`.

**Aucune trame reçue**
Vérifiez que le magnétoscope est en **lecture** (à l'arrêt, beaucoup de
magnétoscopes ne sortent aucun signal). Puis essayez une autre bande passante
isochrone : `--alt 5`, `--alt 6`, `--alt 7`. Sur les Mac récents, branchez le
boîtier directement, pas derrière un hub ou un écran.

**Image noire ou verte alors que les trames arrivent**
Le pont USB fonctionne — c'est déjà l'essentiel — et c'est le décodeur
analogique qui ne fournit pas de pixels. Diagnostiquez d'abord :

```bash
build/dvc100 test
```

Il capture quelques trames et dit ce qu'elles contiennent : **trames vides**
(le décodeur n'envoie rien), **image uniforme** (chaîne numérique bonne, pas de
signal analogique — magnétoscope à l'arrêt ?) ou **image réelle** (la capture
marche, le problème est ailleurs). Il affiche aussi la commande pour convertir
une trame en PNG et la regarder.

S'il annonce des trames vides, lancez le balayage automatique, magnétoscope en
lecture :

```bash
scripts/tune.sh
```

Il essaie une vingtaine de configurations du décodeur — entrée analogique,
S-Video, format de sortie — et indique celle qui produit une image. Un réglage
isolé peut aussi se forcer à la main :

```bash
build/dvc100 test --i2c-set 0x02=0xc1     # sélection de l'entrée analogique
build/dvc100 test --i2c-set 0x11=0x1c     # sortie numérique du décodeur
```

**Image en noir et blanc**
Mauvaise norme couleur : essayez `--standard secam` puis `--standard ntsc`.
`dvc100 probe` affiche « couleur : sous-porteuse verrouillée » quand c'est bon.

**Image décalée, bandes sur le côté**
Fenêtre de capture mal centrée : `--hstart 2 --vstart 0` (essayez 0 à 8).

**Image saccadée, beaucoup de « paquets perdus »**
Augmentez la profondeur du pipeline USB : `--transfers 16 --packets 128`.

**macOS refuse d'ouvrir l'application**
Elle est signée localement, pas notariée. Clic droit → Ouvrir, ou
`xattr -dr com.apple.quarantine build/VHSRecorder.app`.

---

## État du projet, en toute franchise

Ce que je peux garantir : le protocole implémenté est celui de la puce EM28xx
tel que documenté par le pilote Linux de référence, le code compile, la chaîne
capture → aperçu → ffmpeg est complète, et tous les paramètres sensibles sont
réglables à chaud.

Ce que je ne peux pas garantir : **je n'ai pas pu tester sur votre boîtier**
— je n'ai ni le matériel ni un Mac ici. Les valeurs propres à la carte (init du
décodeur, horloges, fenêtre de capture) sont des valeurs de départ raisonnables,
pas des valeurs vérifiées sur un DVC100. Il est donc probable qu'un ou deux
réglages soient à corriger au premier essai. C'est exactement pour ça que
`probe` existe et que tout est paramétrable : envoyez-moi la sortie de
`build/dvc100 probe` et de `build/dvc100 stream --duration 5 --stats > /dev/null`,
et je fige les bonnes valeurs par défaut.

## Si vous voulez un résultat garanti tout de suite

Le pilote Linux `em28xx`, lui, gère le DVC100 depuis quinze ans. On peut s'en
servir depuis le Mac via une machine virtuelle avec redirection USB — c'est
moins élégant, mais c'est sûr :

```bash
brew install --cask utm            # gratuit, Apple Silicon et Intel
# 1. Installer une VM Debian/Ubuntu dans UTM
# 2. VM en marche : menu USB d'UTM → cocher le boîtier Dazzle
# 3. Dans la VM :
sudo apt install ffmpeg v4l-utils
v4l2-ctl --list-devices                    # doit montrer em28xx
ffmpeg -f v4l2 -standard PAL -i /dev/video0 \
       -f alsa -i hw:1 -c:v libx264 -crf 18 cassette.mp4
# 4. Récupérer le fichier via un dossier partagé
```

À performances égales, le pilote natif de ce projet reste préférable : pas de
VM à faire tourner pendant trois heures, et l'aperçu est direct.

---

## Notes techniques

- **Transport** : l'EM2860 envoie la vidéo en transferts *isochrones* USB. Une
  trame commence par un en-tête de 4 octets `22 5a`, dont le bit 0 du 3ᵉ octet
  donne la parité de la demi-image ; `33 95` marque les données VBI (ignorées).
  Le pilote réassemble les deux demi-images en une trame entrelacée complète.
- **Format** : YUYV (YUV 4:2:2 empaqueté), 720×576 en PAL/SECAM, 720×480 en
  NTSC — soit 829 440 ou 691 200 octets par trame.
- **Registres** : le pont s'adresse par requêtes de contrôle vendeur
  (`bRequest 0x00` pour les registres, `0x02` pour le bus I2C interne où vit le
  décodeur SAA711x). Voir `src/em28xx.h` pour la cartographie.
- **Aucune extension noyau** : tout passe par libusb en espace utilisateur, donc
  rien à installer dans le système, rien à désactiver côté sécurité, et ça
  fonctionne aussi bien sur Apple Silicon que sur Intel.
