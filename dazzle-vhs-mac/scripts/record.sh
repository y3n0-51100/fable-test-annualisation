#!/bin/bash
# Enregistre une cassette en H.264 sans passer par l'application.
#
#   scripts/record.sh ma-cassette.mp4              # PAL, composite, sans son
#   scripts/record.sh -s secam -a 1 vacances.mp4   # SECAM + entree audio n°1
#   scripts/record.sh -d 7200 integrale.mp4        # arret automatique a 2 h
#
# Pour connaitre le numero de l'entree audio :
#   ffmpeg -f avfoundation -list_devices true -i ""

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DVC100="${DVC100:-$HERE/build/dvc100}"

standard=pal
input=composite
audio=""
duration=""
crf=18

usage() {
    sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    echo
    echo "Options : -s pal|secam|ntsc  -i composite|svideo  -a INDEX_AUDIO"
    echo "          -d SECONDES  -q CRF (14 = archivage, 18 = defaut, 23 = compact)"
    exit "${1:-0}"
}

while getopts "s:i:a:d:q:h" opt; do
    case "$opt" in
        s) standard="$OPTARG" ;;
        i) input="$OPTARG" ;;
        a) audio="$OPTARG" ;;
        d) duration="$OPTARG" ;;
        q) crf="$OPTARG" ;;
        h) usage 0 ;;
        *) usage 2 ;;
    esac
done
shift $((OPTIND - 1))

output="${1:-cassette-$(date +%Y%m%d-%H%M%S).mp4}"

if [ ! -x "$DVC100" ]; then
    echo "dvc100 introuvable ($DVC100) - lancez 'make' d'abord." >&2
    exit 1
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg manquant : brew install ffmpeg" >&2; exit 1; }

case "$standard" in
    ntsc) size=720x480; rate=30000/1001 ;;
    *)    size=720x576; rate=25 ;;
esac

dvc_args=(stream --standard "$standard" --input "$input" --stats)
[ -n "$duration" ] && dvc_args+=(--duration "$duration")

ff_args=(-hide_banner -f rawvideo -pix_fmt yuyv422 -s "$size" -r "$rate" -i pipe:0)
if [ -n "$audio" ]; then
    ff_args+=(-f avfoundation -i ":$audio" -c:a aac -b:a 192k)
fi
ff_args+=(-vf yadif=1 -c:v libx264 -crf "$crf" -preset slow -pix_fmt yuv420p
          -aspect 4:3 -movflags +faststart -y "$output")

echo "Enregistrement vers $output ($standard, $input) - Ctrl-C pour arreter."
"$DVC100" "${dvc_args[@]}" | ffmpeg "${ff_args[@]}"
echo "Termine : $output"
