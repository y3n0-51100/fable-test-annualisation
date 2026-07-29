#!/bin/bash
# Cherche automatiquement le reglage du decodeur analogique qui donne une
# image, en essayant les cablages possibles les uns apres les autres.
#
#   scripts/tune.sh              # balayage standard (PAL)
#   scripts/tune.sh -s secam     # en SECAM
#
# METTEZ LE MAGNETOSCOPE EN LECTURE avant de lancer : le script mesure ce qui
# arrive reellement, il ne peut rien trouver sur une entree muette.
#
# Chaque essai dure quelques secondes. A la fin, le script affiche la
# combinaison gagnante et la commande a utiliser.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DVC100="${DVC100:-$HERE/build/dvc100}"
FRAMES="${FRAMES:-8}"

standard=pal
while getopts "s:h" opt; do
    case "$opt" in
        s) standard="$OPTARG" ;;
        *) echo "usage: $0 [-s pal|secam|ntsc]"; exit 0 ;;
    esac
done

[ -x "$DVC100" ] || { echo "dvc100 introuvable ($DVC100) - lancez 'make'." >&2; exit 1; }

best_score=0
best_label=""
best_args=""

# Lance un essai et renvoie le pourcentage d'octets non nuls.
try() {
    local label="$1"; shift
    local output score
    output="$("$DVC100" test --standard "$standard" --frames "$FRAMES" "$@" 2>/dev/null)"
    score="$(printf '%s\n' "$output" | awk -F'[:%]' '/Octets non nuls/ {gsub(/ /,"",$2); print $2}')"
    [ -z "$score" ] && score=0

    local variation
    variation="$(printf '%s\n' "$output" | awk -F'[:%]' '/Variation/ {gsub(/ /,"",$2); print $2}')"
    [ -z "$variation" ] && variation=0

    printf "  %-38s %6s %% d'octets utiles, %5s %% de variation\n" \
           "$label" "$score" "$variation"

    # Une image vivante vaut mieux qu'une mire figee : on privilegie la
    # variation entre trames, qui ne ment pas.
    local weighted
    weighted="$(awk -v s="$score" -v v="$variation" 'BEGIN { printf "%d", s + v * 10 }')"
    if [ "$weighted" -gt "$best_score" ]; then
        best_score="$weighted"
        best_label="$label"
        best_args="$*"
    fi
}

echo "Balayage des reglages du decodeur (norme $standard, $FRAMES trames par essai)."
echo "Magnetoscope en lecture ? C'est indispensable."
echo

echo "1. Entree analogique (registre 0x02 du decodeur) :"
for mux in 0xc0 0xc1 0xc2 0xc3 0xc4 0xc5 0xc6 0xc7; do
    try "composite, mux $mux" --i2c-set "0x02=$mux"
done

echo
echo "2. Entree S-Video :"
for mux in 0xc8 0xc9 0xca 0xcb; do
    try "s-video, mux $mux" --input svideo --i2c-set "0x02=$mux"
done

echo
echo "3. Sortie numerique du decodeur (registre 0x11) :"
for out in 0x0c 0x1c 0x0d 0x00; do
    try "sortie $out" --i2c-set "0x11=$out"
done

echo
echo "4. Format de sortie du decodeur (registre 0x10) :"
for fmt in 0x00 0x08 0x40 0x48; do
    try "format $fmt" --i2c-set "0x10=$fmt"
done

echo
echo "5. Temoins :"
try "decodeur non initialise" --skip-decoder
try "reglages par defaut"

echo
if [ "$best_score" -le 0 ]; then
    cat <<'EOF'
Aucun reglage n'a produit d'image.

Si tous les essais affichent 0 %, le decodeur ne fournit rien du tout. Deux
pistes, dans l'ordre :
  1. Le magnetoscope etait-il bien en lecture, fiche jaune sur VIDEO OUT ?
  2. Lancez `build/dvc100 probe` et envoyez la sortie complete : elle dira si
     le decodeur repond sur le bus I2C et de quel modele il s'agit.
EOF
    exit 1
fi

echo "Meilleur resultat : $best_label"
echo
echo "Pour enregistrer avec ce reglage :"
echo "  scripts/record.sh -s $standard ma-cassette.mp4   # apres avoir fige le reglage"
echo
echo "Envoyez-moi cette sortie complete : je figerai ce reglage par defaut dans"
echo "le code, pour que l'application l'utilise sans rien avoir a taper."
