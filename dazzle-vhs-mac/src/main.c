/*
 * main.c - `dvc100` command line tool.
 *
 *   dvc100 probe                 inspect the grabber and report what it is
 *   dvc100 stream [options]      write raw YUYV frames to stdout / a file
 *
 * `stream` is deliberately dumb: it emits raw frames and lets ffmpeg (or the
 * VHSRecorder app) do the encoding. That keeps the USB path free of anything
 * that could stall it while a tape is playing.
 */

#include "em28xx.h"

#include <errno.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/time.h>
#include <unistd.h>

static em_device *g_dev = NULL;

static void on_signal(int sig)
{
    (void)sig;
    if (g_dev)
        em_stop(g_dev);
}

static void usage(FILE *out)
{
    fprintf(out,
"dvc100 - capture video analogique pour boitiers Empia EM28xx (Dazzle DVC100)\n"
"\n"
"Usage :\n"
"  dvc100 probe [options]            identifie le boitier, dump registres + I2C\n"
"  dvc100 test  [options]            capture quelques trames et dit ce qu'elles\n"
"                                    contiennent (vide / noir / vraie image)\n"
"  dvc100 stream [options]           sort des trames YUYV brutes sur stdout\n"
"\n"
"Options principales :\n"
"  --standard pal|ntsc|secam   norme video (defaut: pal)\n"
"  --input composite|svideo    entree utilisee (defaut: composite)\n"
"  --output FICHIER            ecrire dans un fichier plutot que stdout\n"
"  --duration SECONDES         arret automatique apres N secondes\n"
"  --frames N                  arret automatique apres N trames\n"
"  --stats                     statistiques de flux sur stderr (1x/s)\n"
"  -v, --verbose               trace chaque acces registre/I2C\n"
"\n"
"Reglages materiels (a n'utiliser que si l'image est absente/decalee) :\n"
"  --vid 0xXXXX --pid 0xXXXX   forcer l'identifiant USB du boitier\n"
"  --width N --height N        geometrie de capture (defaut 720x576 / 720x480)\n"
"  --hstart N --vstart N       origine de la fenetre de capture\n"
"  --alt N                     forcer l'alt setting isochrone\n"
"  --xclk 0xXX --i2c-clk 0xXX  horloges du pont\n"
"  --transfers N --packets N   profondeur du pipeline USB (defaut 8 x 64)\n"
"  --i2c-init FICHIER          table d'init du decodeur (lignes \"reg=valeur\")\n"
"  --i2c-set REG=VAL           ecrire un registre du decodeur apres init\n"
"                              (repetable ; c'est ce que balaye scripts/tune.sh)\n"
"  --skip-decoder              ne pas toucher au decodeur analogique\n"
"  --reg REG=VAL               ecrire un registre du pont apres configuration\n"
"                              (repetable, jusqu'a 16 fois)\n"
"\n"
"Exemple - enregistrer une cassette PAL en H.264 :\n"
"  dvc100 stream --standard pal | \\\n"
"    ffmpeg -f rawvideo -pix_fmt yuyv422 -s 720x576 -r 25 -i - \\\n"
"           -vf yadif=1 -c:v libx264 -crf 18 -preset slow cassette.mp4\n");
}

struct sink {
    FILE    *f;
    uint64_t frames;
    uint64_t max_frames;
    double   deadline;      /* 0 = none */
    bool     stats;
    double   last_report;
    em_device *dev;
};

static double now_seconds(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return tv.tv_sec + tv.tv_usec / 1e6;
}

static int on_frame(const uint8_t *data, size_t len, void *user)
{
    struct sink *s = user;

    if (fwrite(data, 1, len, s->f) != len) {
        fprintf(stderr, "\nerreur d'ecriture (%s) - arret\n", strerror(errno));
        return 1;
    }
    s->frames++;

    double t = now_seconds();
    if (s->stats && t - s->last_report >= 1.0) {
        const em_stats *st = em_get_stats(s->dev);
        fprintf(stderr,
                "\r%llu trames | %.1f Mo | paquets ok %.1f%% | perdus %llu   ",
                (unsigned long long)s->frames,
                st->bytes / 1e6,
                st->iso_packets ? 100.0 * (double)st->iso_packets_ok / (double)st->iso_packets : 0.0,
                (unsigned long long)st->dropped);
        fflush(stderr);
        s->last_report = t;
    }

    if (s->max_frames && s->frames >= s->max_frames)
        return 1;
    if (s->deadline && t >= s->deadline)
        return 1;
    return 0;
}

/* ------------------------------------------------------------------ */
/* `test` : are the frames carrying an actual picture?                 */
/* ------------------------------------------------------------------ */

struct probe_stats {
    uint64_t frames;
    uint64_t wanted;
    uint64_t nonzero_bytes;
    uint64_t total_bytes;
    unsigned y_min, y_max;
    unsigned c_min, c_max;
    uint64_t y_sum;
    uint64_t y_count;
    /* movement between two consecutive frames */
    uint8_t *previous;
    size_t   previous_len;
    uint64_t changed_bytes;
};

static int on_test_frame(const uint8_t *data, size_t len, void *user)
{
    struct probe_stats *s = user;

    for (size_t i = 0; i + 1 < len; i += 2) {
        unsigned y = data[i];
        unsigned c = data[i + 1];
        if (y) s->nonzero_bytes++;
        if (c) s->nonzero_bytes++;
        if (y < s->y_min) s->y_min = y;
        if (y > s->y_max) s->y_max = y;
        if (c < s->c_min) s->c_min = c;
        if (c > s->c_max) s->c_max = c;
        s->y_sum += y;
        s->y_count++;
    }
    s->total_bytes += len;

    if (s->previous && s->previous_len == len) {
        for (size_t i = 0; i < len; i++)
            if (s->previous[i] != data[i])
                s->changed_bytes++;
    }
    if (!s->previous) {
        s->previous = malloc(len);
        s->previous_len = len;
    }
    if (s->previous && s->previous_len == len)
        memcpy(s->previous, data, len);

    s->frames++;
    fprintf(stderr, "\rtrames analysees : %llu/%llu",
            (unsigned long long)s->frames, (unsigned long long)s->wanted);
    fflush(stderr);
    return s->frames >= s->wanted ? 1 : 0;
}

static void report_test(const struct probe_stats *s, const em_config *cfg)
{
    printf("\n\n--- Analyse du contenu ---\n");
    if (s->frames == 0) {
        printf("Aucune trame recue : le boitier n'envoie rien du tout.\n");
        return;
    }

    double nonzero = 100.0 * (double)s->nonzero_bytes / (double)(s->total_bytes ? s->total_bytes : 1);
    double changed = 100.0 * (double)s->changed_bytes /
                     (double)(s->previous_len * (s->frames > 1 ? s->frames - 1 : 1));
    unsigned y_mean = (unsigned)(s->y_count ? s->y_sum / s->y_count : 0);

    printf("Trames             : %llu de %zu octets\n",
           (unsigned long long)s->frames, s->previous_len);
    printf("Octets non nuls    : %.2f %%\n", nonzero);
    printf("Luminance (Y)      : min %u, max %u, moyenne %u\n",
           s->y_min, s->y_max, y_mean);
    printf("Chrominance (U/V)  : min %u, max %u\n", s->c_min, s->c_max);
    printf("Variation d'une trame a l'autre : %.2f %% des octets\n", changed);

    printf("\nVerdict : ");
    if (nonzero < 0.5) {
        printf("TRAMES VIDES.\n"
               "  Le pont USB envoie bien des trames, mais elles ne contiennent que\n"
               "  des zeros : le decodeur analogique ne lui fournit aucun pixel.\n"
               "  C'est un probleme de configuration du decodeur, pas de branchement.\n"
               "  Essayez : scripts/tune.sh   (balayage des reglages du decodeur)\n");
    } else if (s->y_max - s->y_min < 8 && changed < 0.5) {
        printf("IMAGE UNIFORME (Y autour de %u).\n", y_mean);
        if (y_mean >= 10 && y_mean <= 40) {
            printf("  C'est un noir propre : la chaine numerique fonctionne, mais il n'y a\n"
                   "  pas de signal analogique en entree. Le magnetoscope est-il en LECTURE,\n"
                   "  la fiche jaune sur sa sortie VIDEO OUT ?\n");
        } else {
            printf("  Le decodeur sort une valeur constante : reglage a ajuster.\n"
                   "  Essayez : scripts/tune.sh\n");
        }
    } else {
        printf("IMAGE REELLE DETECTEE.\n"
               "  Les trames contiennent une vraie image qui evolue dans le temps.\n"
               "  Si l'apercu de l'application reste vert, le probleme est dans son\n"
               "  affichage, pas dans la capture : enregistrez et ouvrez le fichier.\n");
    }

    printf("\nPour voir l'image capturee :\n"
           "  build/dvc100 stream --standard %s --frames 1 > /tmp/vhs.yuv && \\\n"
           "  ffmpeg -y -f rawvideo -pix_fmt yuyv422 -s %dx%d -i /tmp/vhs.yuv \\\n"
           "         -frames:v 1 /tmp/vhs.png && open /tmp/vhs.png\n",
           cfg->standard == EM_STD_NTSC ? "ntsc" :
           (cfg->standard == EM_STD_SECAM ? "secam" : "pal"),
           em_config_width(cfg), em_config_height(cfg));
}

static int parse_int(const char *s, int *out)
{
    char *end = NULL;
    long v = strtol(s, &end, 0);
    if (!end || *end != '\0')
        return -1;
    *out = (int)v;
    return 0;
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        usage(stderr);
        return 2;
    }

    const char *cmd = argv[1];
    if (!strcmp(cmd, "-h") || !strcmp(cmd, "--help") || !strcmp(cmd, "help")) {
        usage(stdout);
        return 0;
    }
    if (strcmp(cmd, "probe") && strcmp(cmd, "stream") && strcmp(cmd, "test")) {
        fprintf(stderr, "commande inconnue: %s\n\n", cmd);
        usage(stderr);
        return 2;
    }

    em_config cfg;
    em_config_defaults(&cfg);

    uint16_t vid = 0, pid = 0;
    const char *output = NULL;
    int duration = 0, max_frames = 0;
    bool stats = false;
    struct { uint8_t reg, val; } overrides[16];
    int n_overrides = 0;

    for (int i = 2; i < argc; i++) {
        const char *a = argv[i];
        const char *next = (i + 1 < argc) ? argv[i + 1] : NULL;
        int v = 0;

        #define NEED_ARG() do { \
            if (!next) { fprintf(stderr, "%s attend une valeur\n", a); return 2; } \
        } while (0)

        if (!strcmp(a, "--standard")) {
            NEED_ARG();
            if (!strcasecmp(next, "pal")) cfg.standard = EM_STD_PAL;
            else if (!strcasecmp(next, "ntsc")) cfg.standard = EM_STD_NTSC;
            else if (!strcasecmp(next, "secam")) cfg.standard = EM_STD_SECAM;
            else { fprintf(stderr, "norme inconnue: %s\n", next); return 2; }
            i++;
        } else if (!strcmp(a, "--input")) {
            NEED_ARG();
            if (!strcasecmp(next, "composite")) cfg.input = EM_INPUT_COMPOSITE;
            else if (!strcasecmp(next, "svideo") || !strcasecmp(next, "s-video"))
                cfg.input = EM_INPUT_SVIDEO;
            else { fprintf(stderr, "entree inconnue: %s\n", next); return 2; }
            i++;
        } else if (!strcmp(a, "--output") || !strcmp(a, "-o")) {
            NEED_ARG(); output = next; i++;
        } else if (!strcmp(a, "--vid")) {
            NEED_ARG(); if (parse_int(next, &v)) return 2; vid = (uint16_t)v; i++;
        } else if (!strcmp(a, "--pid")) {
            NEED_ARG(); if (parse_int(next, &v)) return 2; pid = (uint16_t)v; i++;
        } else if (!strcmp(a, "--width")) {
            NEED_ARG(); if (parse_int(next, &cfg.width)) return 2; i++;
        } else if (!strcmp(a, "--height")) {
            NEED_ARG(); if (parse_int(next, &cfg.height)) return 2; i++;
        } else if (!strcmp(a, "--hstart")) {
            NEED_ARG(); if (parse_int(next, &cfg.hstart)) return 2; i++;
        } else if (!strcmp(a, "--vstart")) {
            NEED_ARG(); if (parse_int(next, &cfg.vstart)) return 2; i++;
        } else if (!strcmp(a, "--alt")) {
            NEED_ARG(); if (parse_int(next, &cfg.alt_setting)) return 2; i++;
        } else if (!strcmp(a, "--xclk")) {
            NEED_ARG(); if (parse_int(next, &cfg.xclk)) return 2; i++;
        } else if (!strcmp(a, "--i2c-clk")) {
            NEED_ARG(); if (parse_int(next, &cfg.i2c_clk)) return 2; i++;
        } else if (!strcmp(a, "--transfers")) {
            NEED_ARG(); if (parse_int(next, &cfg.num_transfers)) return 2; i++;
        } else if (!strcmp(a, "--packets")) {
            NEED_ARG(); if (parse_int(next, &cfg.packets_per_transfer)) return 2; i++;
        } else if (!strcmp(a, "--i2c-init")) {
            NEED_ARG(); cfg.i2c_init_path = next; i++;
        } else if (!strcmp(a, "--skip-decoder")) {
            cfg.skip_decoder_init = true;
        } else if (!strcmp(a, "--i2c-set")) {
            NEED_ARG();
            unsigned reg, val;
            if (sscanf(next, "%i%*[=:]%i", &reg, &val) != 2 || cfg.n_i2c_set >= 16) {
                fprintf(stderr, "--i2c-set attend REG=VAL (max 16)\n");
                return 2;
            }
            cfg.i2c_set[cfg.n_i2c_set].reg = (uint8_t)reg;
            cfg.i2c_set[cfg.n_i2c_set].val = (uint8_t)val;
            cfg.n_i2c_set++;
            i++;
        } else if (!strcmp(a, "--duration")) {
            NEED_ARG(); if (parse_int(next, &duration)) return 2; i++;
        } else if (!strcmp(a, "--frames")) {
            NEED_ARG(); if (parse_int(next, &max_frames)) return 2; i++;
        } else if (!strcmp(a, "--stats")) {
            stats = true;
        } else if (!strcmp(a, "--reg")) {
            NEED_ARG();
            unsigned reg, val;
            if (sscanf(next, "%i%*[=:]%i", &reg, &val) != 2 || n_overrides >= 16) {
                fprintf(stderr, "--reg attend REG=VAL (max 16)\n");
                return 2;
            }
            overrides[n_overrides].reg = (uint8_t)reg;
            overrides[n_overrides].val = (uint8_t)val;
            n_overrides++;
            i++;
        } else if (!strcmp(a, "-v") || !strcmp(a, "--verbose")) {
            cfg.verbose = true;
        } else {
            fprintf(stderr, "option inconnue: %s\n\n", a);
            usage(stderr);
            return 2;
        }
        #undef NEED_ARG
    }

    libusb_context *ctx = NULL;
    int rc = libusb_init(&ctx);
    if (rc < 0) {
        fprintf(stderr, "libusb_init a echoue: %s\n", libusb_strerror(rc));
        return 1;
    }

    char err[512] = "";
    em_device *dev = em_open(ctx, vid, pid, &cfg, err, sizeof(err));
    if (!dev) {
        fprintf(stderr, "%s\n", err);
        libusb_exit(ctx);
        return 1;
    }
    g_dev = dev;
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGPIPE, SIG_IGN);

    int status = 0;

    if (!strcmp(cmd, "probe")) {
        em_describe(dev, stdout);
        em_dump_registers(dev, stdout);
        em_scan_i2c(dev, stdout);
        uint8_t addr = 0;
        fprintf(stdout, "\n");
        if (saa711x_detect(dev, &addr) == 0)
            saa711x_status(dev, addr, stdout);
        else
            fprintf(stdout, "Decodeur          : non detecte\n");
        fprintf(stdout,
            "\nGeometrie prevue  : %dx%d @ %.2f i/s, YUYV (%zu octets/trame)\n",
            em_config_width(&cfg), em_config_height(&cfg), em_config_fps(&cfg),
            (size_t)em_config_width(&cfg) * em_config_height(&cfg) * 2);
        goto done;
    }

    if (em_configure(dev, err, sizeof(err)) < 0) {
        fprintf(stderr, "%s\n", err);
        status = 1;
        goto done;
    }

    for (int i = 0; i < n_overrides; i++)
        em_write_reg(dev, overrides[i].reg, overrides[i].val);

    if (!strcmp(cmd, "test")) {
        struct probe_stats ps;
        memset(&ps, 0, sizeof(ps));
        ps.wanted = (uint64_t)(max_frames > 0 ? max_frames : 25);
        ps.y_min = ps.c_min = 255;
        if (em_stream(dev, on_test_frame, &ps, err, sizeof(err)) < 0) {
            fprintf(stderr, "\n%s\n", err);
            status = 1;
        }
        report_test(&ps, &cfg);
        free(ps.previous);
        goto done;
    }

    struct sink sink;
    memset(&sink, 0, sizeof(sink));
    sink.f = stdout;
    sink.dev = dev;
    sink.stats = stats;
    sink.max_frames = (uint64_t)(max_frames > 0 ? max_frames : 0);
    sink.deadline = duration > 0 ? now_seconds() + duration : 0;
    sink.last_report = now_seconds();

    if (output) {
        sink.f = fopen(output, "wb");
        if (!sink.f) {
            fprintf(stderr, "impossible d'ecrire %s: %s\n", output, strerror(errno));
            status = 1;
            goto done;
        }
    }

    /* Machine-readable header for the GUI, always on stderr so it never
     * pollutes the frame stream. */
    fprintf(stderr, "FORMAT yuyv422 %dx%d %.4f\n",
            em_config_width(&cfg), em_config_height(&cfg), em_config_fps(&cfg));
    fflush(stderr);

    if (em_stream(dev, on_frame, &sink, err, sizeof(err)) < 0) {
        fprintf(stderr, "%s\n", err);
        status = 1;
    }

    fflush(sink.f);
    if (sink.f != stdout)
        fclose(sink.f);

    const em_stats *st = em_get_stats(dev);
    fprintf(stderr, "\n%llu trames, %.1f Mo, %llu paquets isochrones "
                    "(%llu utiles), %llu octets hors cadre\n",
            (unsigned long long)sink.frames, st->bytes / 1e6,
            (unsigned long long)st->iso_packets,
            (unsigned long long)st->iso_packets_ok,
            (unsigned long long)st->dropped);

    if (sink.frames == 0) {
        fprintf(stderr,
            "\nAucune trame recue. Pistes, dans l'ordre :\n"
            "  1. le magnetoscope est-il en lecture, cable jaune sur l'entree video ?\n"
            "  2. `dvc100 probe` : le decodeur repond-il, le signal est-il detecte ?\n"
            "  3. essayez --standard secam/ntsc, puis --input svideo\n"
            "  4. essayez --alt 5 ou --alt 6 si la bande passante isochrone est refusee\n");
        status = status ? status : 1;
    }

done:
    g_dev = NULL;
    em_close(dev);
    libusb_exit(ctx);
    return status;
}
