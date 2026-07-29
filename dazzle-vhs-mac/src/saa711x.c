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

static const saa_reg saa711x_default_init[] = {
    { 0x01, 0x08 },   /* horizontal increment delay                     */
    { 0x02, 0xc0 },   /* analog input 1: CVBS on AI11, automatic gain   */
    { 0x03, 0x33 },   /* analog input 2: gain control, white peak off   */
    { 0x04, 0x00 },   /* static gain channel 1                          */
    { 0x05, 0x00 },   /* static gain channel 2                          */
    { 0x06, 0xeb },   /* horizontal sync begin                          */
    { 0x07, 0xe0 },   /* horizontal sync stop                           */
    { 0x08, 0x98 },   /* sync control, automatic field detection on     */
    { 0x09, 0x01 },   /* luminance control, chroma trap on (composite)  */
    { 0x0a, 0x80 },   /* brightness (128 = neutral)                     */
    { 0x0b, 0x47 },   /* contrast   (71 = neutral)                      */
    { 0x0c, 0x40 },   /* saturation (64 = neutral)                      */
    { 0x0d, 0x00 },   /* hue                                            */
    { 0x0e, 0x01 },   /* chroma control: PAL BGHIN, comb filter on      */
    { 0x0f, 0x2a },   /* chroma gain, automatic                         */
    { 0x10, 0x00 },   /* format/delay control                           */
    { 0x11, 0x0c },   /* output control 1: VPO active, ITU-R BT.656     */
    { 0x12, 0x07 },   /* RTS0/RTS1 pin function                         */
    { 0x13, 0x00 },   /* output control 3                               */
    { 0x15, 0x00 },   /* VGATE start                                    */
    { 0x16, 0x00 },   /* VGATE stop                                     */
    { 0x17, 0x00 },   /* VGATE MSB / field polarity                     */
};

/* --------------------------------------------------------------- */

int saa711x_detect(em_device *dev, uint8_t *addr_out)
{
    static const uint8_t candidates[] = {
        I2C_ADDR_SAA711X, I2C_ADDR_SAA711X_ALT, 0x40, 0x42, 0x4c, 0x4e,
    };
    for (size_t i = 0; i < sizeof(candidates); i++) {
        int v = em_i2c_read_reg(dev, candidates[i], SAA_R00_CHIP_VERSION);
        if (v >= 0) {
            if (addr_out)
                *addr_out = candidates[i];
            return 0;
        }
    }
    return -1;
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
    const saa_reg *table = saa711x_default_init;
    size_t count = sizeof(saa711x_default_init) / sizeof(saa711x_default_init[0]);
    saa_reg *loaded = NULL;

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
    /* Register 0x0E bits 6:4 select the colour standard; register 0x08
     * bit 6 selects 60 Hz when automatic field detection is disabled. */
    uint8_t chroma, sync;
    switch (std) {
    case EM_STD_NTSC:
        chroma = 0x31;      /* NTSC M, 3.58 MHz, comb filter on */
        sync   = 0x58;      /* 60 Hz field rate                 */
        break;
    case EM_STD_SECAM:
        chroma = 0x71;      /* SECAM                            */
        sync   = 0x18;      /* 50 Hz field rate                 */
        break;
    case EM_STD_PAL:
    default:
        chroma = 0x01;      /* PAL BGHIN, 4.43 MHz              */
        sync   = 0x18;      /* 50 Hz field rate                 */
        break;
    }

    int rc = 0;
    rc |= em_i2c_write_reg(dev, addr, SAA_R0E_CHROMA_CTRL, chroma);
    rc |= em_i2c_write_reg(dev, addr, SAA_R08_SYNC_CTRL, sync);
    return rc;
}

int saa711x_status(em_device *dev, uint8_t addr, FILE *out)
{
    int ver = em_i2c_read_reg(dev, addr, SAA_R00_CHIP_VERSION);
    int st = em_i2c_read_reg(dev, addr, SAA_R1F_STATUS);
    if (ver < 0 || st < 0) {
        fprintf(out, "Decodeur 0x%02x    : pas de reponse\n", addr);
        return -1;
    }
    fprintf(out, "Decodeur          : 0x%02x, version 0x%02x, statut 0x%02x\n",
            addr, ver, st);
    fprintf(out, "  signal video    : %s\n",
            (st & 0x40) ? "absent ou instable" : "detecte");
    fprintf(out, "  entrelacement   : %s\n",
            (st & 0x80) ? "interlace" : "non entrelace/inconnu");
    fprintf(out, "  couleur         : %s\n",
            (st & 0x01) ? "sous-porteuse verrouillee" : "non verrouillee (N&B ?)");
    return 0;
}
