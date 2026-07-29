/*
 * em28xx.c - EM28xx bridge access + isochronous video capture.
 */

#include "em28xx.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define CTRL_TIMEOUT_MS 1000
#define I2C_RETRIES     32

/* USB IDs reported for EM28xx-based analog grabbers. The DVC100 has shipped
 * under several IDs over its life, so this is a starting point, not a
 * whitelist: --vid/--pid override it and `probe` lists every plausible
 * candidate on the bus. */
static const struct { uint16_t vid, pid; const char *name; } known_devices[] = {
    { 0x2304, 0x021a, "Pinnacle/Dazzle DVC100" },
    { 0x2304, 0x0207, "Pinnacle Dazzle DVC90/DVC100" },
    { 0x2304, 0x0208, "Pinnacle Dazzle DVC90" },
    { 0x2304, 0x021b, "Pinnacle Dazzle DVC101" },
    { 0x2304, 0x021c, "Pinnacle Dazzle DVC107" },
    { 0x1b80, 0xe302, "EM2860 grabber (Kaiser Baas / clone)" },
    { 0x1b80, 0xe304, "EM2860 grabber (clone)" },
    { 0xeb1a, 0x2860, "Empia EM2860 reference" },
    { 0xeb1a, 0x2861, "Empia EM2861 reference" },
    { 0xeb1a, 0x2870, "Empia EM2870 reference" },
    { 0xeb1a, 0x2881, "Empia EM2881 reference" },
};

struct em_device {
    libusb_context       *ctx;
    libusb_device_handle *h;
    libusb_device        *dev;
    em_config             cfg;

    int      iface;
    int      alt;
    uint8_t  ep;
    int      packet_size;
    uint8_t  decoder_addr;

    /* frame assembly */
    uint8_t *frame;
    size_t   frame_size;
    size_t   line_bytes;
    int      height;
    size_t   field_pos;     /* bytes written into the current field */
    int      field;         /* 0 = top, 1 = bottom */
    bool     have_data;

    /* streaming */
    struct libusb_transfer **transfers;
    int      n_transfers;
    int      active;
    volatile bool stop;
    em_frame_cb cb;
    void    *cb_user;
    int      cb_rc;

    em_stats stats;
};

/* ------------------------------------------------------------------ */
/* Configuration                                                      */
/* ------------------------------------------------------------------ */

void em_config_defaults(em_config *cfg)
{
    memset(cfg, 0, sizeof(*cfg));
    cfg->standard = EM_STD_PAL;
    cfg->input = EM_INPUT_COMPOSITE;
    cfg->width = 0;
    cfg->height = 0;
    cfg->hstart = 0;
    cfg->vstart = 0;
    cfg->alt_setting = -1;
    cfg->xclk = -1;
    cfg->i2c_clk = -1;
    cfg->num_transfers = 8;
    cfg->packets_per_transfer = 64;
}

int em_config_width(const em_config *cfg)
{
    if (cfg->width > 0)
        return cfg->width;
    return 720;
}

int em_config_height(const em_config *cfg)
{
    if (cfg->height > 0)
        return cfg->height;
    return cfg->standard == EM_STD_NTSC ? 480 : 576;
}

double em_config_fps(const em_config *cfg)
{
    return cfg->standard == EM_STD_NTSC ? 30000.0 / 1001.0 : 25.0;
}

/* ------------------------------------------------------------------ */
/* Register access                                                    */
/* ------------------------------------------------------------------ */

static int ctrl_read(em_device *dev, uint8_t req, uint16_t index,
                     uint8_t *buf, int len)
{
    return libusb_control_transfer(dev->h,
        LIBUSB_ENDPOINT_IN | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE,
        req, 0x0000, index, buf, (uint16_t)len, CTRL_TIMEOUT_MS);
}

static int ctrl_write(em_device *dev, uint8_t req, uint16_t index,
                      const uint8_t *buf, int len)
{
    return libusb_control_transfer(dev->h,
        LIBUSB_ENDPOINT_OUT | LIBUSB_REQUEST_TYPE_VENDOR | LIBUSB_RECIPIENT_DEVICE,
        req, 0x0000, index, (unsigned char *)buf, (uint16_t)len, CTRL_TIMEOUT_MS);
}

int em_read_reg(em_device *dev, uint8_t reg)
{
    uint8_t val = 0;
    int rc = ctrl_read(dev, EM28XX_REQ_REG, reg, &val, 1);
    if (rc < 0)
        return rc;
    if (rc != 1)
        return LIBUSB_ERROR_IO;
    return val;
}

int em_write_reg(em_device *dev, uint8_t reg, uint8_t val)
{
    int rc = ctrl_write(dev, EM28XX_REQ_REG, reg, &val, 1);
    if (dev->cfg.verbose)
        fprintf(stderr, "[reg] 0x%02x <- 0x%02x (%d)\n", reg, val, rc);
    return rc < 0 ? rc : 0;
}

int em_write_reg_bits(em_device *dev, uint8_t reg, uint8_t val, uint8_t mask)
{
    int old = em_read_reg(dev, reg);
    if (old < 0)
        return old;
    uint8_t new_val = (uint8_t)((old & ~mask) | (val & mask));
    return em_write_reg(dev, reg, new_val);
}

/* ------------------------------------------------------------------ */
/* I2C                                                                */
/* ------------------------------------------------------------------ */

/* The bridge reports the outcome of the last I2C transaction in R05:
 * 0x00 = ACK, 0x10 = NACK (no device at that address). */
static int i2c_wait(em_device *dev)
{
    for (int i = 0; i < I2C_RETRIES; i++) {
        int st = em_read_reg(dev, EM28XX_R05_I2C_STATUS);
        if (st < 0)
            return st;
        if ((st & 0x10) == 0)
            return 0;               /* ACK */
        if (st == 0x10)
            return LIBUSB_ERROR_NO_DEVICE; /* NACK */
        usleep(1000);
    }
    return LIBUSB_ERROR_TIMEOUT;
}

int em_i2c_write(em_device *dev, uint8_t addr, const uint8_t *buf, int len)
{
    int rc = ctrl_write(dev, EM28XX_REQ_I2C, addr, buf, len);
    if (rc < 0)
        return rc;
    return i2c_wait(dev);
}

int em_i2c_read(em_device *dev, uint8_t addr, uint8_t *buf, int len)
{
    int rc = ctrl_read(dev, EM28XX_REQ_I2C, addr, buf, len);
    if (rc < 0)
        return rc;
    int st = i2c_wait(dev);
    if (st < 0)
        return st;
    return rc;
}

int em_i2c_write_reg(em_device *dev, uint8_t addr, uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    int rc = em_i2c_write(dev, addr, buf, 2);
    if (dev->cfg.verbose)
        fprintf(stderr, "[i2c] %02x: 0x%02x <- 0x%02x (%d)\n", addr, reg, val, rc);
    return rc;
}

int em_i2c_read_reg(em_device *dev, uint8_t addr, uint8_t reg)
{
    uint8_t val = 0;
    int rc = em_i2c_write(dev, addr, &reg, 1);
    if (rc < 0)
        return rc;
    rc = em_i2c_read(dev, addr, &val, 1);
    if (rc < 0)
        return rc;
    return val;
}

/* ------------------------------------------------------------------ */
/* Open / close                                                       */
/* ------------------------------------------------------------------ */

static bool is_known_device(uint16_t vid, uint16_t pid, const char **name)
{
    for (size_t i = 0; i < sizeof(known_devices) / sizeof(known_devices[0]); i++) {
        if (known_devices[i].vid == vid && known_devices[i].pid == pid) {
            if (name)
                *name = known_devices[i].name;
            return true;
        }
    }
    return false;
}

/* Actual bytes per microframe, taking the high-speed multiplier into account. */
static int packet_bytes(uint16_t wMaxPacketSize)
{
    int size = wMaxPacketSize & 0x07ff;
    int mult = ((wMaxPacketSize >> 11) & 0x03) + 1;
    return size * mult;
}

/* Pick the interface / alt setting exposing the fattest isochronous IN
 * endpoint - that is the video pipe on every EM28xx board. */
static int select_endpoint(em_device *dev, libusb_device *usbdev, char *err, size_t errlen)
{
    struct libusb_config_descriptor *conf = NULL;
    int rc = libusb_get_active_config_descriptor(usbdev, &conf);
    if (rc < 0) {
        snprintf(err, errlen, "impossible de lire la configuration USB: %s",
                 libusb_strerror(rc));
        return rc;
    }

    int best_size = -1;
    for (int i = 0; i < conf->bNumInterfaces; i++) {
        const struct libusb_interface *iface = &conf->interface[i];
        for (int a = 0; a < iface->num_altsetting; a++) {
            const struct libusb_interface_descriptor *alt = &iface->altsetting[a];
            if (alt->bInterfaceClass != LIBUSB_CLASS_VENDOR_SPEC)
                continue;
            if (dev->cfg.alt_setting >= 0 && alt->bAlternateSetting != dev->cfg.alt_setting)
                continue;
            for (int e = 0; e < alt->bNumEndpoints; e++) {
                const struct libusb_endpoint_descriptor *ep = &alt->endpoint[e];
                if ((ep->bmAttributes & 0x03) != LIBUSB_TRANSFER_TYPE_ISOCHRONOUS)
                    continue;
                if (!(ep->bEndpointAddress & LIBUSB_ENDPOINT_IN))
                    continue;
                int size = packet_bytes(ep->wMaxPacketSize);
                if (size > best_size) {
                    best_size = size;
                    dev->iface = alt->bInterfaceNumber;
                    dev->alt = alt->bAlternateSetting;
                    dev->ep = ep->bEndpointAddress;
                    dev->packet_size = size;
                }
            }
        }
    }
    libusb_free_config_descriptor(conf);

    if (best_size <= 0) {
        snprintf(err, errlen,
                 "aucun endpoint isochrone d'entree trouve sur ce peripherique");
        return LIBUSB_ERROR_NOT_FOUND;
    }
    return 0;
}

em_device *em_open(libusb_context *ctx, uint16_t vid, uint16_t pid,
                   const em_config *cfg, char *err, size_t errlen)
{
    libusb_device **list = NULL;
    ssize_t n = libusb_get_device_list(ctx, &list);
    if (n < 0) {
        snprintf(err, errlen, "enumeration USB impossible: %s", libusb_strerror((int)n));
        return NULL;
    }

    libusb_device *found = NULL;
    for (ssize_t i = 0; i < n; i++) {
        struct libusb_device_descriptor d;
        if (libusb_get_device_descriptor(list[i], &d) < 0)
            continue;
        if (vid || pid) {
            if (d.idVendor == vid && d.idProduct == pid) {
                found = list[i];
                break;
            }
        } else if (is_known_device(d.idVendor, d.idProduct, NULL)) {
            found = list[i];
            break;
        }
    }

    if (!found) {
        snprintf(err, errlen,
                 "aucun boitier EM28xx reconnu. Branchez le DVC100 puis relancez "
                 "`dvc100 probe`, et forcez l'ID avec --vid/--pid si besoin.");
        libusb_free_device_list(list, 1);
        return NULL;
    }

    em_device *dev = calloc(1, sizeof(*dev));
    if (!dev) {
        snprintf(err, errlen, "memoire insuffisante");
        libusb_free_device_list(list, 1);
        return NULL;
    }
    dev->ctx = ctx;
    dev->cfg = *cfg;
    dev->dev = libusb_ref_device(found);

    int rc = libusb_open(found, &dev->h);
    libusb_free_device_list(list, 1);
    if (rc < 0) {
        snprintf(err, errlen,
                 "ouverture du peripherique impossible (%s). Sur macOS cela arrive "
                 "si un autre programme l'utilise deja.", libusb_strerror(rc));
        libusb_unref_device(dev->dev);
        free(dev);
        return NULL;
    }

    if (select_endpoint(dev, dev->dev, err, errlen) < 0) {
        em_close(dev);
        return NULL;
    }

    libusb_set_auto_detach_kernel_driver(dev->h, 1);
    rc = libusb_claim_interface(dev->h, dev->iface);
    if (rc < 0) {
        snprintf(err, errlen, "claim_interface(%d) a echoue: %s",
                 dev->iface, libusb_strerror(rc));
        em_close(dev);
        return NULL;
    }

    return dev;
}

void em_close(em_device *dev)
{
    if (!dev)
        return;
    if (dev->h) {
        /* Drop the video pipe back to the zero-bandwidth alt setting so the
         * device is left in a sane state for the next run. */
        libusb_set_interface_alt_setting(dev->h, dev->iface, 0);
        libusb_release_interface(dev->h, dev->iface);
        libusb_close(dev->h);
    }
    if (dev->dev)
        libusb_unref_device(dev->dev);
    free(dev->frame);
    free(dev->transfers);
    free(dev);
}

const em_stats *em_get_stats(em_device *dev)
{
    return &dev->stats;
}

/* ------------------------------------------------------------------ */
/* Introspection                                                      */
/* ------------------------------------------------------------------ */

void em_describe(em_device *dev, FILE *out)
{
    struct libusb_device_descriptor d;
    if (libusb_get_device_descriptor(dev->dev, &d) == 0) {
        const char *name = "inconnu";
        is_known_device(d.idVendor, d.idProduct, &name);
        fprintf(out, "Peripherique      : %04x:%04x (%s)\n",
                d.idVendor, d.idProduct, name);
    }
    fprintf(out, "Bus/adresse       : %d/%d\n",
            libusb_get_bus_number(dev->dev), libusb_get_device_address(dev->dev));
    fprintf(out, "Interface video   : %d, alt %d, endpoint 0x%02x, %d o/paquet\n",
            dev->iface, dev->alt, dev->ep, dev->packet_size);

    int chipid = em_read_reg(dev, EM28XX_R0A_CHIPID);
    int chipcfg = em_read_reg(dev, EM28XX_R00_CHIPCFG);
    if (chipid >= 0) {
        const char *chip = "EM28xx";
        switch (chipid) {
        case 0x23: chip = "EM2800"; break;
        case 0x24: chip = "EM2800"; break;
        case 0x30: chip = "EM2820/EM2840"; break;
        case 0x33: chip = "EM2860"; break;
        case 0x34: chip = "EM2870/EM2883"; break;
        case 0x35: chip = "EM2870"; break;
        case 0x36: chip = "EM2874"; break;
        case 0x37: chip = "EM2874B"; break;
        case 0x3b: chip = "EM2884"; break;
        case 0x3c: chip = "EM2874B"; break;
        default: break;
        }
        fprintf(out, "Chip ID (R0A)     : 0x%02x (%s)\n", chipid, chip);
    } else {
        fprintf(out, "Chip ID (R0A)     : lecture impossible (%s)\n",
                libusb_strerror(chipid));
    }
    if (chipcfg >= 0)
        fprintf(out, "Chip config (R00) : 0x%02x\n", chipcfg);

    /* Full interface map. What matters for sound: a standard USB audio class
     * interface means macOS drives it by itself and ffmpeg can record it;
     * anything else means the audio is behind the vendor protocol and macOS
     * cannot see it at all. */
    struct libusb_config_descriptor *conf = NULL;
    if (libusb_get_active_config_descriptor(dev->dev, &conf) == 0) {
        bool audio_class = false;
        fprintf(out, "Interfaces USB    :\n");
        for (int i = 0; i < conf->bNumInterfaces; i++) {
            for (int a = 0; a < conf->interface[i].num_altsetting; a++) {
                const struct libusb_interface_descriptor *alt =
                    &conf->interface[i].altsetting[a];
                const char *class_name;
                switch (alt->bInterfaceClass) {
                case LIBUSB_CLASS_AUDIO:       class_name = "audio"; audio_class = true; break;
                case LIBUSB_CLASS_VIDEO:       class_name = "video (UVC)"; break;
                case LIBUSB_CLASS_HID:         class_name = "HID"; break;
                case LIBUSB_CLASS_VENDOR_SPEC: class_name = "specifique vendeur"; break;
                default:                       class_name = "autre"; break;
                }
                fprintf(out, "  itf %d alt %d  classe 0x%02x (%s)",
                        alt->bInterfaceNumber, alt->bAlternateSetting,
                        alt->bInterfaceClass, class_name);
                for (int e = 0; e < alt->bNumEndpoints; e++) {
                    const struct libusb_endpoint_descriptor *ep = &alt->endpoint[e];
                    static const char *types[] = { "ctrl", "isoc", "bulk", "intr" };
                    fprintf(out, "  [ep 0x%02x %s %d o]",
                            ep->bEndpointAddress,
                            types[ep->bmAttributes & 0x03],
                            packet_bytes(ep->wMaxPacketSize));
                }
                fprintf(out, "\n");
            }
        }
        fprintf(out, "Audio USB Class   : %s\n", audio_class
                ? "oui - le son apparait comme entree audio macOS standard"
                : "non - macOS ne peut pas voir le son de ce boitier, "
                  "il faut passer par une entree ligne (voir README)");
        libusb_free_config_descriptor(conf);
    }
}

void em_dump_registers(em_device *dev, FILE *out)
{
    fprintf(out, "\nRegistres du pont EM28xx :\n     ");
    for (int i = 0; i < 16; i++)
        fprintf(out, " %02x", i);
    for (int reg = 0; reg < 0x50; reg++) {
        if ((reg & 0x0f) == 0)
            fprintf(out, "\n0x%02x:", reg);
        int v = em_read_reg(dev, (uint8_t)reg);
        if (v < 0)
            fprintf(out, " --");
        else
            fprintf(out, " %02x", v);
    }
    fprintf(out, "\n");
}

void em_scan_i2c(em_device *dev, FILE *out)
{
    fprintf(out, "\nScan du bus I2C interne :\n");
    int found = 0;
    for (int addr = 0x02; addr < 0xff; addr += 2) {
        uint8_t probe = 0;
        int rc = em_i2c_read(dev, (uint8_t)addr, &probe, 1);
        if (rc >= 0) {
            const char *hint = "";
            if (addr == I2C_ADDR_SAA711X || addr == I2C_ADDR_SAA711X_ALT)
                hint = " (decodeur video SAA711x probable)";
            else if (addr == I2C_ADDR_EEPROM)
                hint = " (EEPROM de configuration)";
            fprintf(out, "  - 0x%02x repond%s\n", addr, hint);
            found++;
        }
    }
    if (!found)
        fprintf(out, "  (aucune reponse - le bus est peut-etre encore endormi ;\n"
                     "   relancez apres `dvc100 stream --dry-run`)\n");
}

/* ------------------------------------------------------------------ */
/* Video configuration                                                */
/* ------------------------------------------------------------------ */

static int set_capture_area(em_device *dev, int hstart, int vstart, int width, int height)
{
    uint8_t cwidth = (uint8_t)(width >> 2);
    uint8_t cheight = (uint8_t)(height >> 2);
    uint8_t overflow = (uint8_t)(((height >> 9) & 0x02) | ((width >> 10) & 0x01));

    int rc = 0;
    rc |= em_write_reg(dev, EM28XX_R1B_OFLOW, overflow);
    rc |= em_write_reg(dev, EM28XX_R1C_HSTART, (uint8_t)hstart);
    rc |= em_write_reg(dev, EM28XX_R1D_VSTART, (uint8_t)vstart);
    rc |= em_write_reg(dev, EM28XX_R1E_CWIDTH, cwidth);
    rc |= em_write_reg(dev, EM28XX_R1F_CHEIGHT, cheight);
    return rc;
}

static int set_scaler_off(em_device *dev)
{
    int rc = 0;
    rc |= em_write_reg_bits(dev, EM28XX_R26_COMPR, 0x00, 0x30);
    rc |= em_write_reg(dev, EM28XX_R30_HSCALELOW, 0x00);
    rc |= em_write_reg(dev, EM28XX_R31_HSCALEHIGH, 0x00);
    rc |= em_write_reg(dev, EM28XX_R32_VSCALELOW, 0x00);
    rc |= em_write_reg(dev, EM28XX_R33_VSCALEHIGH, 0x00);
    return rc;
}

int em_configure(em_device *dev, char *err, size_t errlen)
{
    int width = em_config_width(&dev->cfg);
    int height = em_config_height(&dev->cfg);

    uint8_t xclk = dev->cfg.xclk >= 0 ? (uint8_t)dev->cfg.xclk
        : (EM28XX_XCLK_IR_RC5_MODE | EM28XX_XCLK_FREQUENCY_12MHZ);
    uint8_t i2c_clk = dev->cfg.i2c_clk >= 0 ? (uint8_t)dev->cfg.i2c_clk
        : (EM28XX_I2C_CLK_WAIT_ENABLE | EM28XX_I2C_EEPROM_ON_BOARD |
           EM28XX_I2C_EEPROM_KEY_VALID | EM28XX_I2C_FREQ_100_KHZ);

    if (em_write_reg(dev, EM28XX_R0F_XCLK, xclk) < 0 ||
        em_write_reg(dev, EM28XX_R06_I2C_CLK, i2c_clk) < 0) {
        snprintf(err, errlen, "le pont ne repond pas aux ecritures de registres");
        return -1;
    }
    usleep(50000);

    /* Analog decoder. Failure here is not fatal on its own: some boards come
     * up already configured, and the user can iterate with --i2c-init. */
    if (!dev->cfg.skip_decoder_init) {
        uint8_t addr = 0;
        if (saa711x_detect(dev, &addr) == 0) {
            dev->decoder_addr = addr;
            char derr[256] = "";
            if (saa711x_init(dev, addr, &dev->cfg, derr, sizeof(derr)) < 0)
                fprintf(stderr, "attention: init du decodeur incomplete: %s\n", derr);
            saa711x_set_standard(dev, addr, dev->cfg.standard);
            saa711x_set_input(dev, addr, dev->cfg.input);
            for (int i = 0; i < dev->cfg.n_i2c_set; i++)
                em_i2c_write_reg(dev, addr, dev->cfg.i2c_set[i].reg,
                                 dev->cfg.i2c_set[i].val);
        } else {
            fprintf(stderr,
                    "attention: aucun decodeur SAA711x detecte sur le bus I2C.\n"
                    "           L'image sera probablement noire. Lancez `dvc100 probe`\n"
                    "           et envoyez la sortie pour ajuster la table d'init.\n");
        }
    }

    /* Bridge video path: 16-bit YUV422 out, interlaced analog in. */
    uint8_t outfmt = EM28XX_OUTFMT_YUV422_Y0UY1V | 0x20;
    int rc = 0;
    rc |= em_write_reg(dev, EM28XX_R27_OUTFMT, outfmt);
    rc |= em_write_reg(dev, EM28XX_R10_VINMODE, 0x10);
    rc |= em_write_reg(dev, EM28XX_R11_VINCTRL, 0x11);
    rc |= set_capture_area(dev, dev->cfg.hstart, dev->cfg.vstart, width, height);
    rc |= set_scaler_off(dev);
    if (rc < 0) {
        snprintf(err, errlen, "configuration video refusee par le pont");
        return -1;
    }

    /* Allocate the frame accumulator. */
    dev->line_bytes = (size_t)width * 2;
    dev->height = height;
    dev->frame_size = dev->line_bytes * (size_t)height;
    free(dev->frame);
    dev->frame = calloc(1, dev->frame_size);
    if (!dev->frame) {
        snprintf(err, errlen, "memoire insuffisante pour %zu octets", dev->frame_size);
        return -1;
    }
    dev->field_pos = 0;
    dev->field = 0;
    dev->have_data = false;
    return 0;
}

/* ------------------------------------------------------------------ */
/* Frame assembly                                                     */
/* ------------------------------------------------------------------ */

static void emit_frame(em_device *dev)
{
    if (!dev->have_data)
        return;
    dev->stats.frames++;
    if (dev->cb && dev->cb_rc == 0)
        dev->cb_rc = dev->cb(dev->frame, dev->frame_size, dev->cb_user);
    dev->have_data = false;
}

/* Copy payload into the interlaced accumulator: line n of the current field
 * lands on frame line 2n (top field) or 2n+1 (bottom field). */
static void copy_field_data(em_device *dev, const uint8_t *src, size_t len)
{
    while (len > 0) {
        size_t line = dev->field_pos / dev->line_bytes;
        size_t in_line = dev->field_pos % dev->line_bytes;
        size_t dst_line = line * 2 + (size_t)dev->field;
        if (dst_line >= (size_t)dev->height) {
            dev->stats.dropped += len;
            return;
        }
        size_t chunk = dev->line_bytes - in_line;
        if (chunk > len)
            chunk = len;
        memcpy(dev->frame + dst_line * dev->line_bytes + in_line, src, chunk);
        src += chunk;
        len -= chunk;
        dev->field_pos += chunk;
        dev->have_data = true;
    }
}

/* EM28xx payload framing: a packet that starts a field carries a 4-byte
 * header. 0x22 0x5a marks video (bit 0 of byte 2 = field parity),
 * 0x33 0x95 marks VBI data, which we discard. */
static void process_packet(em_device *dev, const uint8_t *data, int len)
{
    if (len < 4)
        return;

    if (data[0] == 0x22 && data[1] == 0x5a) {
        int field = data[2] & 0x01;
        if (field == 0) {
            /* A new top field means the previous frame is complete. */
            emit_frame(dev);
        }
        dev->field = field;
        dev->field_pos = 0;
        data += 4;
        len -= 4;
    } else if (data[0] == 0x33 && data[1] == 0x95) {
        return;             /* VBI field, not useful for plain capture */
    } else if (data[0] == 0x88 && data[1] == 0x88 &&
               data[2] == 0x88 && data[3] == 0x88) {
        return;             /* EM25xx style header, unused here */
    }

    if (len > 0)
        copy_field_data(dev, data, (size_t)len);
}

static void LIBUSB_CALL iso_callback(struct libusb_transfer *xfr)
{
    em_device *dev = xfr->user_data;

    if (xfr->status == LIBUSB_TRANSFER_CANCELLED ||
        xfr->status == LIBUSB_TRANSFER_NO_DEVICE) {
        dev->active--;
        return;
    }

    for (int i = 0; i < xfr->num_iso_packets; i++) {
        struct libusb_iso_packet_descriptor *pkt = &xfr->iso_packet_desc[i];
        dev->stats.iso_packets++;
        if (pkt->status != LIBUSB_TRANSFER_COMPLETED || pkt->actual_length == 0)
            continue;
        dev->stats.iso_packets_ok++;
        dev->stats.bytes += pkt->actual_length;
        process_packet(dev, libusb_get_iso_packet_buffer_simple(xfr, i),
                       (int)pkt->actual_length);
    }

    if (dev->stop || dev->cb_rc != 0) {
        dev->active--;
        return;
    }

    if (libusb_submit_transfer(xfr) < 0)
        dev->active--;
}

/* ------------------------------------------------------------------ */
/* Streaming                                                          */
/* ------------------------------------------------------------------ */

void em_stop(em_device *dev)
{
    if (dev)
        dev->stop = true;
}

int em_stream(em_device *dev, em_frame_cb cb, void *user, char *err, size_t errlen)
{
    dev->cb = cb;
    dev->cb_user = user;
    dev->cb_rc = 0;
    dev->stop = false;

    int rc = libusb_set_interface_alt_setting(dev->h, dev->iface, dev->alt);
    if (rc < 0) {
        snprintf(err, errlen,
                 "impossible de selectionner l'alt setting %d (%s) - la bande "
                 "passante isochrone est peut-etre deja prise sur ce port USB",
                 dev->alt, libusb_strerror(rc));
        return rc;
    }

    /* Start the video path. 0x67 enables the capture engine on EM286x. */
    em_write_reg(dev, EM28XX_R12_VINENABLE, 0x67);

    int n = dev->cfg.num_transfers;
    int pkts = dev->cfg.packets_per_transfer;
    dev->transfers = calloc((size_t)n, sizeof(*dev->transfers));
    if (!dev->transfers) {
        snprintf(err, errlen, "memoire insuffisante");
        return -1;
    }
    dev->n_transfers = n;

    size_t buf_len = (size_t)pkts * (size_t)dev->packet_size;
    int setup_rc = 0;
    for (int i = 0; i < n; i++) {
        uint8_t *buf = malloc(buf_len);
        struct libusb_transfer *xfr = libusb_alloc_transfer(pkts);
        if (!buf || !xfr) {
            snprintf(err, errlen, "allocation des transferts isochrones impossible");
            free(buf);
            if (xfr)
                libusb_free_transfer(xfr);
            setup_rc = LIBUSB_ERROR_NO_MEM;
            break;
        }
        libusb_fill_iso_transfer(xfr, dev->h, dev->ep, buf, (int)buf_len,
                                 pkts, iso_callback, dev, 1000);
        libusb_set_iso_packet_lengths(xfr, dev->packet_size);
        xfr->flags = LIBUSB_TRANSFER_FREE_BUFFER;

        rc = libusb_submit_transfer(xfr);
        if (rc < 0) {
            snprintf(err, errlen, "submit_transfer a echoue: %s", libusb_strerror(rc));
            libusb_free_transfer(xfr);      /* frees the buffer too */
            setup_rc = rc;
            break;
        }
        /* Only transfers that are actually in flight go in the table: the
         * drain loop below cancels exactly those. */
        dev->transfers[i] = xfr;
        dev->active++;
    }
    if (setup_rc < 0)
        dev->stop = true;                   /* drain what is already in flight */

    struct timeval tv = { 0, 100000 };
    while (dev->active > 0) {
        if ((dev->stop || dev->cb_rc != 0)) {
            for (int i = 0; i < dev->n_transfers; i++)
                if (dev->transfers[i])
                    libusb_cancel_transfer(dev->transfers[i]);
        }
        rc = libusb_handle_events_timeout_completed(dev->ctx, &tv, NULL);
        if (rc < 0 && rc != LIBUSB_ERROR_INTERRUPTED) {
            snprintf(err, errlen, "boucle d'evenements USB interrompue: %s",
                     libusb_strerror(rc));
            break;
        }
    }

    em_write_reg(dev, EM28XX_R12_VINENABLE, 0x00);

    for (int i = 0; i < dev->n_transfers; i++)
        if (dev->transfers[i])
            libusb_free_transfer(dev->transfers[i]);
    free(dev->transfers);
    dev->transfers = NULL;
    dev->n_transfers = 0;

    if (setup_rc < 0)
        return setup_rc;
    return dev->cb_rc > 0 ? 0 : dev->cb_rc;
}
