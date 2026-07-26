# 🎯 Mastermind — Duel de couleurs

Un jeu de **Mastermind** fun, coloré et fluide. Un joueur cache une
combinaison secrète de pions colorés, l'autre doit la reconstituer à l'aide
des indices donnés à chaque essai.

- **100 % statique** : HTML / CSS / JavaScript vanilla, **aucune dépendance**,
  aucun serveur ni étape de build. Hébergeable tel quel (GitHub Pages,
  Netlify, n'importe quel serveur de fichiers).
- **Deux modes de jeu** :
  - **2 Joueurs (pass-and-play)** — le Joueur 1 compose le code en secret,
    passe l'appareil, le Joueur 2 cherche.
  - **Solo** — perce le code généré aléatoirement par l'ordinateur.
- **Design soigné** : dégradés animés, pions colorés, animations fluides,
  confettis à la victoire, petits sons générés à la volée (Web Audio, aucun
  fichier audio), interface responsive (pensée mobile d'abord) et entièrement
  en français.

## Démarrage

Ouvrez simplement `index.html` dans un navigateur, ou servez le dossier :

```bash
cd mastermind
python3 -m http.server 8000   # puis http://localhost:8000
# ou : npx serve .
```

## Règles

À chaque proposition, le jeu affiche des indices (non ordonnés) :

- 🟢 **Pion vert** — bonne couleur, **au bon emplacement**.
- ⚪ **Pion blanc** — bonne couleur, mais **au mauvais emplacement**.

La position des indices ne révèle pas quel pion est correct : à vous de
déduire les couleurs et leur ordre avant d'épuiser vos essais.

## Difficultés

| Niveau     | Emplacements | Couleurs | Essais |
|------------|:------------:|:--------:|:------:|
| Facile     | 4            | 6        | 12     |
| Classique  | 4            | 6        | 10     |
| Difficile  | 5            | 7        | 10     |
| Expert     | 5            | 8        | 8      |

Un interrupteur permet aussi d'**autoriser ou non les doublons** de couleurs
dans le code (désactivé automatiquement s'il n'y a pas assez de couleurs).

## Structure

```
mastermind/
├── index.html   # structure des écrans (accueil, réglages, jeu, fin)
├── styles.css   # thème coloré, animations, responsive
└── game.js      # logique de jeu, indices, sons, confettis
```

## Notes techniques

- Le calcul des indices gère correctement les **doublons** (algorithme
  standard : on compte d'abord les positions exactes, puis les couleurs
  restantes sans double-comptage).
- Le mode « 2 Joueurs » se joue **sur le même appareil** (pass-and-play).
  Un mode en ligne temps réel pourrait être ajouté ultérieurement via un
  backend (WebSocket / Firebase / Supabase).
- `prefers-reduced-motion` est respecté pour les personnes sensibles aux
  animations.
