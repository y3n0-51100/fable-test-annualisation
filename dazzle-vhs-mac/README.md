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

Le DVC100 expose (selon les révisions) son entrée audio comme un périphérique
audio USB standard : dans ce cas macOS le voit tout seul, il apparaît dans
Réglages Système → Son, et l'application le propose dans la liste « Audio ».
`dvc100 probe` indique si c'est le cas sur votre exemplaire (ligne
« Audio USB Class »). Sinon, il faut relier la sortie audio du magnétoscope à
une entrée ligne du Mac (ou à une petite interface USB audio) et choisir cette
entrée dans l'application.

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

**Image noire mais des trames arrivent**
Le pont fonctionne, c'est le décodeur analogique qui n'est pas configuré comme
sur votre carte. Essayez `--input svideo`, puis modifiez la table
d'initialisation sans recompiler :

```bash
cat > decodeur.txt <<'EOF'
0x02 = 0xc1     # essayer c0, c1, c2… : sélection de l'entrée analogique
0x09 = 0x01
0x0e = 0x01
EOF
build/dvc100 stream --i2c-init decodeur.txt --stats > /dev/null
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
