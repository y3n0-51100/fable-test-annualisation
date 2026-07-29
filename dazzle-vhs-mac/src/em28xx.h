/*
 * em28xx.h - userspace driver for Empia EM28xx analog capture bridges
 *            (Dazzle DVC100 and relatives) on macOS, via libusb.
 *
 * Register map and initialisation sequences are transcribed from the Linux
 * kernel driver (drivers/media/usb/em28xx), which is the reference
 * documentation for this silicon. Anything that is board-specific rather than
 * chip-specific is exposed as a runtime option, because board wiring (GPIO,
 * input muxing, xclk) varies between DVC100 revisions and cannot be guessed.
 */

#ifndef EM28XX_H
#define EM28XX_H

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#include <libusb.h>

/* ------------------------------------------------------------------ */
/* EM28xx bridge registers                                            */
/* ------------------------------------------------------------------ */

#define EM28XX_R00_CHIPCFG      0x00
#define EM28XX_R04_GPO          0x04
#define EM28XX_R05_I2C_STATUS   0x05
#define EM28XX_R06_I2C_CLK      0x06
#define EM28XX_R08_GPIO         0x08
#define EM28XX_R0A_CHIPID       0x0a
#define EM28XX_R0C_USBSUSP      0x0c
#define EM28XX_R0E_AUDIOSRC     0x0e
#define EM28XX_R0F_XCLK         0x0f
#define EM28XX_R10_VINMODE      0x10
#define EM28XX_R11_VINCTRL      0x11
#define EM28XX_R12_VINENABLE    0x12
#define EM28XX_R14_GAMMA        0x14
#define EM28XX_R15_RGAIN        0x15
#define EM28XX_R16_GGAIN        0x16
#define EM28XX_R17_BGAIN        0x17
#define EM28XX_R18_ROFFSET      0x18
#define EM28XX_R19_GOFFSET      0x19
#define EM28XX_R1A_BOFFSET      0x1a
#define EM28XX_R1B_OFLOW        0x1b
#define EM28XX_R1C_HSTART       0x1c
#define EM28XX_R1D_VSTART       0x1d
#define EM28XX_R1E_CWIDTH       0x1e
#define EM28XX_R1F_CHEIGHT      0x1f
#define EM28XX_R20_YGAIN        0x20
#define EM28XX_R21_YOFFSET      0x21
#define EM28XX_R22_UVGAIN       0x22
#define EM28XX_R23_UOFFSET      0x23
#define EM28XX_R24_VOFFSET      0x24
#define EM28XX_R26_COMPR        0x26
#define EM28XX_R27_OUTFMT       0x27
#define EM28XX_R28_XMIN         0x28
#define EM28XX_R29_XMAX         0x29
#define EM28XX_R2A_YMIN         0x2a
#define EM28XX_R2B_YMAX         0x2b
#define EM28XX_R30_HSCALELOW    0x30
#define EM28XX_R31_HSCALEHIGH   0x31
#define EM28XX_R32_VSCALELOW    0x32
#define EM28XX_R33_VSCALEHIGH   0x33
#define EM28XX_R40_AC97LSB      0x40
#define EM28XX_R41_AC97MSB      0x41
#define EM28XX_R42_AC97ADDR     0x42
#define EM28XX_R43_AC97BUSY     0x43

/* R27 output formats */
#define EM28XX_OUTFMT_YUV422_Y0UY1V 0x14
#define EM28XX_OUTFMT_YUV422_Y1UY0V 0x15
#define EM28XX_OUTFMT_YUV411        0x18

/* R11 video input control */
#define EM28XX_VINCTRL_VBI_RAW      0x20
#define EM28XX_VINCTRL_INTERLACED   0x10
#define EM28XX_VINCTRL_CCIR656_ENABLE 0x08

/* R0F xclk */
#define EM28XX_XCLK_AUDIO_UNMUTE    0x80
#define EM28XX_XCLK_IR_RC5_MODE     0x40
#define EM28XX_XCLK_IR_NEC_CHK_PARITY 0x20
#define EM28XX_XCLK_FREQUENCY_30MHZ 0x00
#define EM28XX_XCLK_FREQUENCY_15MHZ 0x01
#define EM28XX_XCLK_FREQUENCY_10MHZ 0x02
#define EM28XX_XCLK_FREQUENCY_7_5MHZ 0x03
#define EM28XX_XCLK_FREQUENCY_6MHZ  0x04
#define EM28XX_XCLK_FREQUENCY_5MHZ  0x05
#define EM28XX_XCLK_FREQUENCY_4_3MHZ 0x06
#define EM28XX_XCLK_FREQUENCY_12MHZ 0x07
#define EM28XX_XCLK_FREQUENCY_20MHZ 0x08
#define EM28XX_XCLK_FREQUENCY_20MHZ_2 0x09
#define EM28XX_XCLK_FREQUENCY_48MHZ 0x0a
#define EM28XX_XCLK_FREQUENCY_24MHZ 0x0b

/* R06 i2c clock */
#define EM28XX_I2C_CLK_WAIT_ENABLE  0x40
#define EM28XX_I2C_EEPROM_ON_BOARD  0x08
#define EM28XX_I2C_EEPROM_KEY_VALID 0x04
#define EM28XX_I2C_FREQ_100_KHZ     0x00
#define EM28XX_I2C_FREQ_25_KHZ      0x01
#define EM28XX_I2C_FREQ_400_KHZ     0x02
#define EM28XX_I2C_FREQ_1_5_MHZ     0x03

/* Vendor control request used for plain register access */
#define EM28XX_REQ_REG      0x00
/* Vendor control request used for I2C traffic on the bridge's bus */
#define EM28XX_REQ_I2C      0x02

/* Known I2C addresses (8-bit / "write" form, as used by the bridge) */
#define I2C_ADDR_SAA711X    0x4a
#define I2C_ADDR_SAA711X_ALT 0x48
#define I2C_ADDR_EEPROM     0xa0

/* ------------------------------------------------------------------ */
/* Video geometry / configuration                                     */
/* ------------------------------------------------------------------ */

typedef enum {
    EM_STD_PAL = 0,     /* 720x576, 25 fps */
    EM_STD_NTSC,        /* 720x480, ~29.97 fps */
    EM_STD_SECAM,       /* 720x576, 25 fps (decoder-side difference only) */
} em_standard;

typedef enum {
    EM_INPUT_COMPOSITE = 0,
    EM_INPUT_SVIDEO,
} em_input;

typedef struct {
    em_standard standard;
    em_input    input;
    int         width;          /* 0 = derive from standard */
    int         height;         /* 0 = derive from standard */
    int         hstart;         /* capture window origin, board dependent */
    int         vstart;
    int         alt_setting;    /* -1 = pick the largest isoc alt setting */
    int         xclk;           /* -1 = default (IR_RC5 | 12 MHz) */
    int         i2c_clk;        /* -1 = default */
    int         num_transfers;  /* in-flight isoc transfers */
    int         packets_per_transfer;
    const char *i2c_init_path;  /* optional override table for the decoder */
    bool        skip_decoder_init;
    bool        verbose;

    /* Decoder registers written last, after init/standard/input. This is the
     * knob for board-specific wiring, and what scripts/tune.sh sweeps. */
    struct { uint8_t reg, val; } i2c_set[16];
    int         n_i2c_set;
} em_config;

void em_config_defaults(em_config *cfg);
int  em_config_width(const em_config *cfg);
int  em_config_height(const em_config *cfg);
double em_config_fps(const em_config *cfg);

/* ------------------------------------------------------------------ */
/* Device handle                                                      */
/* ------------------------------------------------------------------ */

typedef struct em_device em_device;

/* Called for every complete frame. Data is packed YUYV (YUY2), size
 * width*height*2 bytes. Return non-zero to request that streaming stops. */
typedef int (*em_frame_cb)(const uint8_t *data, size_t len, void *user);

/* Open the first supported bridge found on the bus. vid/pid may be 0 to use
 * the built-in match table. */
em_device *em_open(libusb_context *ctx, uint16_t vid, uint16_t pid,
                   const em_config *cfg, char *err, size_t errlen);
void       em_close(em_device *dev);

/* Low level register / I2C helpers (also used by the probe command). */
int em_read_reg(em_device *dev, uint8_t reg);
int em_write_reg(em_device *dev, uint8_t reg, uint8_t val);
int em_write_reg_bits(em_device *dev, uint8_t reg, uint8_t val, uint8_t mask);
int em_i2c_write(em_device *dev, uint8_t addr, const uint8_t *buf, int len);
int em_i2c_read(em_device *dev, uint8_t addr, uint8_t *buf, int len);
int em_i2c_write_reg(em_device *dev, uint8_t addr, uint8_t reg, uint8_t val);
int em_i2c_read_reg(em_device *dev, uint8_t addr, uint8_t reg);

/* Bring the bridge and the analog decoder into the configured video mode. */
int em_configure(em_device *dev, char *err, size_t errlen);

/* Stream until the callback asks to stop or em_stop() is called. */
int em_stream(em_device *dev, em_frame_cb cb, void *user, char *err, size_t errlen);
void em_stop(em_device *dev);

/* Introspection used by `dvc100 probe`. */
void em_describe(em_device *dev, FILE *out);
void em_dump_registers(em_device *dev, FILE *out);
void em_scan_i2c(em_device *dev, FILE *out);

/* Decoder (SAA711x) support, in saa711x.c */
int saa711x_detect(em_device *dev, uint8_t *addr_out);
int saa711x_init(em_device *dev, uint8_t addr, const em_config *cfg,
                 char *err, size_t errlen);
int saa711x_set_input(em_device *dev, uint8_t addr, em_input input);
int saa711x_set_standard(em_device *dev, uint8_t addr, em_standard std);
int saa711x_status(em_device *dev, uint8_t addr, FILE *out);

/* Shared statistics, useful when diagnosing a silent device. */
typedef struct {
    uint64_t iso_packets;
    uint64_t iso_packets_ok;
    uint64_t bytes;
    uint64_t frames;
    uint64_t dropped;
} em_stats;

const em_stats *em_get_stats(em_device *dev);

#endif /* EM28XX_H */
