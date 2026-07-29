/*
 * saa711x.c - Philips/NXP SAA711x analog video decoder, the chip that turns
 *             the VHS composite/S-Video signal into digital YUV for the
 *             EM28xx bridge.
 *
 * The table below is a plain CVBS capture setup derived from the SAA7113H
 * datasheet defaults. Boards differ in how the decoder is wired (which AI
 * pin carries composite, whether S-Video is present at all), so every value
 * here can be replaced at runtime with --i2c-init <file>, one "reg=value"
 * pair per line. That is the knob to turn if the picture comes out black,
 * rolling, or black and white.
 */

#include "em28xx.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define SAA_R00_CHIP_VERSION    0x00
#define SAA_R02_INPUT_CTRL1     0x02
#define SAA_R08_SYNC_CTRL       0x08
#define SAA_R09_LUMA_CTRL       0x09
#define SAA_R0E_CHROMA_CTRL     0x0e
#define SAA_R1F_STATUS          0x1f

typedef struct { uint8_t reg, val; } saa_reg;

/* SAA7111/SAA7111A. The DVC100 uses this one. Register 0x11 vaut 0x1c ici
 * la ou le SAA7113 veut 0x0c : c'est ce qui commande la sortie numerique du
 * decodeur, et donc la difference entre une image et des octets nuls. */
static const saa_reg saa7111_init[] = {
    { 0x01, 0x00 },   /* horizontal increment delay                     */
    { 0x02, 0xc0 },   /* entree analogique : CVBS sur AI11, gain auto   */
    { 0x03, 0x33 },   /* controle d'entree 2                            */
    { 0x04, 0x00 },   /* gain statique canal 1                          */
    { 0x05, 0x00 },   /* gain statique canal 2                          */
    { 0x06, 0xe9 },   /* debut de synchro horizontale                   */
    { 0x07, 0x0d },   /* fin de synchro horizontale                     */
    { 0x08, 0x98 },   /* synchro : detection automatique 50/60 Hz       */
    { 0x09, 0x01 },   /* luminance : trappe chroma active (composite)   */
    { 0x0a, 0x80 },   /* luminosite (128 = neutre)                      */
    { 0x0b, 0x47 },   /* contraste  (71 = neutre)                       */
    { 0x0c, 0x40 },   /* saturation (64 = neutre)                       */
    { 0x0d, 0x00 },   /* teinte                                         */
    { 0x0e, 0x01 },   /* chrominance : PAL BGHIN                        */
    { 0x0f, 0x00 },   /* gain chroma automatique                        */
    { 0x10, 0x48 },   /* controle chroma 2 / retards                    */
    { 0x11, 0x1c },   /* SORTIE NUMERIQUE ACTIVE (valeur specifique 7111) */
    { 0x12, 0x00 },   /* signal temps reel                              */
    { 0x13, 0x00 },   /* port X de sortie                               */
    { 0x14, 0x00 },   /* compatibilite ADC analogique                   */
    { 0x15, 0x00 },   /* VGATE debut                                    */
    { 0x16, 0x00 },   /* VGATE fin                                      */
    { 0x17, 0x00 },   /* VGATE MSB / polarite de trame                  */
};

/* SAA7113 et derives. */
static const saa_reg saa7113_init[] = {
    { 0x01, 0x08 },
    { 0x02, 0xc0 },
    { 0x03, 0x33 },
    { 0x04, 0x00 },
    { 0x05, 0x00 },
    { 0x06, 0xeb },
    { 0x07, 0xe0 },
    { 0x08, 0x98 },
    { 0x09, 0x01 },
    { 0x0a, 0x80 },
    { 0x0b, 0x47 },
    { 0x0c, 0x40 },
    { 0x0d, 0x00 },
    { 0x0e, 0x01 },
    { 0x0f, 0x2a },
    { 0x10, 0x00 },
    { 0x11, 0x0c },
    { 0x12, 0x07 },
    { 0x13, 0x00 },
    { 0x15, 0x00 },
    { 0x16, 0x00 },
    { 0x17, 0x00 },
};

/* --------------------------------------------------------------- */

int saa711x_detect(em_device *dev, uint8_t *addr_out, int *version_out)
{
    static const uint8_t candidates[] = {
        I2C_ADDR_SAA711X, I2C_ADDR_SAA711X_ALT, 0x40, 0x42, 0x4c, 0x4e,
    };
    for (size_t i = 0; i < sizeof(candidates); i++) {
        int v = em_i2c_read_reg(dev, candidates[i], SAA_R00_CHIP_VERSION);
        if (v >= 0) {
            if (addr_out)
                *addr_out = candidates[i];
            if (version_out)
                *version_out = v;
            return 0;
        }
    }
    return -1;
}

/* Le quartet de poids faible du registre 0x00 donne le modele. */
const char *saa711x_model(int version)
{
    switch (version & 0x0f) {
    case 1:  return "SAA7111/7111A";
    case 3:  return "SAA7113";
    case 4:  return "SAA7114";
    case 5:  return "SAA7115";
    case 8:  return "SAA7118";
    default: return "SAA711x inconnu";
    }
}

/* Load "reg=value" pairs (hex or decimal, '#' comments) from a file. */
static int load_init_file(const char *path, saa_reg **out, size_t *n_out)
{
    FILE *f = fopen(path, "r");
    if (!f)
        return -1;

    size_t cap = 64, n = 0;
    saa_reg *table = malloc(cap * sizeof(*table));
    if (!table) {
        fclose(f);
        return -1;
    }

    char line[256];
    while (fgets(line, sizeof(line), f)) {
        char *p = line;
        while (*p && isspace((unsigned char)*p))
            p++;
        if (*p == '#' || *p == ';' || *p == '\0' || *p == '\n')
            continue;
        unsigned reg, val;
        if (sscanf(p, "%i%*[=: \t]%i", &reg, &val) != 2)
            continue;
        if (n == cap) {
            cap *= 2;
            saa_reg *bigger = realloc(table, cap * sizeof(*table));
            if (!bigger) {
                free(table);
                fclose(f);
                return -1;
            }
            table = bigger;
        }
        table[n].reg = (uint8_t)reg;
        table[n].val = (uint8_t)val;
        n++;
    }
    fclose(f);
    *out = table;
    *n_out = n;
    return 0;
}

int saa711x_init(em_device *dev, uint8_t addr, const em_config *cfg,
                 char *err, size_t errlen)
{
    /* Choisir la table selon le modele reellement present : les deux familles
     * ne configurent pas leur sortie numerique de la meme facon. */
    int version = em_i2c_read_reg(dev, addr, SAA_R00_CHIP_VERSION);
    bool is_7111 = version >= 0 && (version & 0x0f) <= 1;

    const saa_reg *table = is_7111 ? saa7111_init : saa7113_init;
    size_t count = is_7111
        ? sizeof(saa7111_init) / sizeof(saa7111_init[0])
        : sizeof(saa7113_init) / sizeof(saa7113_init[0]);
    saa_reg *loaded = NULL;

    if (cfg->verbose && version >= 0)
        fprintf(stderr, "[decodeur] version 0x%02x -> %s, table %s\n",
                version, saa711x_model(version), is_7111 ? "7111" : "7113");

    if (cfg->i2c_init_path) {
        if (load_init_file(cfg->i2c_init_path, &loaded, &count) < 0) {
            snprintf(err, errlen, "table I2C illisible: %s", cfg->i2c_init_path);
            return -1;
        }
        table = loaded;
    }

    int failures = 0;
    for (size_t i = 0; i < count; i++) {
        if (em_i2c_write_reg(dev, addr, table[i].reg, table[i].val) < 0)
            failures++;
        usleep(1000);
    }
    free(loaded);

    if (failures) {
        snprintf(err, errlen, "%d ecriture(s) I2C sur %zu ont echoue", failures, count);
        return -1;
    }
    return 0;
}

int saa711x_set_input(em_device *dev, uint8_t addr, em_input input)
{
    /* Register 0x02 selects the analog mux; 0x09 bit 7 routes chrominance
     * from the second analog channel, which is what S-Video needs. */
    uint8_t in_ctrl = (input == EM_INPUT_SVIDEO) ? 0xc8 : 0xc0;
    int luma = em_i2c_read_reg(dev, addr, SAA_R09_LUMA_CTRL);
    if (luma < 0)
        luma = 0x01;
    uint8_t luma_ctrl = (uint8_t)(input == EM_INPUT_SVIDEO
                                  ? ((luma & ~0x03) | 0x80)   /* bypass chroma trap */
                                  : ((luma & ~0x80) | 0x01)); /* chroma trap on     */

    int rc = 0;
    rc |= em_i2c_write_reg(dev, addr, SAA_R02_INPUT_CTRL1, in_ctrl);
    rc |= em_i2c_write_reg(dev, addr, SAA_R09_LUMA_CTRL, luma_ctrl);
    return rc;
}

int saa711x_set_standard(em_device *dev, uint8_t addr, em_standard std)
{
    /* Registre 0x0E bits 6:4 = norme couleur :
     *   000 PAL BGHIN, 001 NTSC M, 010 NTSC 4.43, 011 PAL M, 100 PAL N,
     *   101 SECAM. Le bit 0 laisse le filtre chroma actif.
     * On garde la detection automatique 50/60 Hz du registre 0x08 : elle est
     * plus fiable qu'un forcage, et un magnetoscope qui demarre a mi-bande
     * peut mettre une seconde a se stabiliser. */
    uint8_t chroma;
    switch (std) {
    case EM_STD_NTSC:  chroma = 0x11; break;   /* NTSC M   */
    case EM_STD_SECAM: chroma = 0x51; break;   /* SECAM    */
    case EM_STD_PAL:
    default:           chroma = 0x01; break;   /* PAL BGHIN */
    }

    int rc = 0;
    rc |= em_i2c_write_reg(dev, addr, SAA_R0E_CHROMA_CTRL, chroma);
    rc |= em_i2c_write_reg(dev, addr, SAA_R08_SYNC_CTRL, 0x98);
    return rc;
}

int saa711x_status(em_device *dev, uint8_t addr, FILE *out)
{
    int ver = em_i2c_read_reg(dev, addr, SAA_R00_CHIP_VERSION);
    int st = em_i2c_read_reg(dev, addr, SAA_R1F_STATUS);
    int mux = em_i2c_read_reg(dev, addr, SAA_R02_INPUT_CTRL1);
    if (ver < 0 || st < 0) {
        fprintf(out, "Decodeur 0x%02x    : pas de reponse\n", addr);
        return -1;
    }
    fprintf(out, "Decodeur          : %s a l'adresse 0x%02x "
                 "(version 0x%02x, statut 0x%02x)\n",
            saa711x_model(ver), addr, ver, st);
    if (mux >= 0)
        fprintf(out, "  entree active   : registre 0x02 = 0x%02x (mode %d)\n",
                mux, mux & 0x0f);
    /* Bit 6 = perte de verrouillage, bit 5 = 60 Hz. Les autres bits varient
     * d'un modele a l'autre et ne sont pas interpretes ici. */
    fprintf(out, "  signal video    : %s\n",
            (st & 0x40) ? "ABSENT ou instable - magnetoscope en lecture ?"
                        : "verrouille");
    fprintf(out, "  cadence detectee: %s\n",
            (st & 0x20) ? "60 Hz (NTSC)" : "50 Hz (PAL/SECAM)");
    return 0;
}
