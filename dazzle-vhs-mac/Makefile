# Dazzle DVC100 -> macOS
#
#   make            construit l'outil en ligne de commande `dvc100`
#   make app        construit en plus l'application VHSRecorder.app
#   make install    copie dvc100 dans /usr/local/bin
#
# Prerequis : brew install libusb ffmpeg   (+ Xcode/CLT pour l'app)

CC          ?= cc
PKG_CONFIG  ?= pkg-config
PREFIX      ?= /usr/local

CFLAGS  ?= -O2 -g -Wall -Wextra -Wno-unused-parameter -std=gnu11
CFLAGS  += $(shell $(PKG_CONFIG) --cflags libusb-1.0 2>/dev/null || echo -I/opt/homebrew/include/libusb-1.0 -I/usr/local/include/libusb-1.0)
LDLIBS  += $(shell $(PKG_CONFIG) --libs libusb-1.0 2>/dev/null || echo -L/opt/homebrew/lib -L/usr/local/lib -lusb-1.0)

BUILD   := build
SRCS    := src/em28xx.c src/saa711x.c src/main.c
OBJS    := $(SRCS:src/%.c=$(BUILD)/%.o)
BIN     := $(BUILD)/dvc100

APP_NAME    := VHSRecorder
APP_BUNDLE  := $(BUILD)/$(APP_NAME).app

.PHONY: all app clean install uninstall check

all: $(BIN)

$(BUILD):
	@mkdir -p $(BUILD)

$(BUILD)/%.o: src/%.c src/em28xx.h | $(BUILD)
	$(CC) $(CFLAGS) -c $< -o $@

$(BIN): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $(OBJS) $(LDLIBS)
	@echo "==> $(BIN) construit. Testez : $(BIN) probe"

check: $(BIN)
	@$(BIN) --help >/dev/null && echo "binaire fonctionnel"

install: $(BIN)
	install -d $(PREFIX)/bin
	install -m 0755 $(BIN) $(PREFIX)/bin/dvc100
	@echo "==> installe dans $(PREFIX)/bin/dvc100"

uninstall:
	rm -f $(PREFIX)/bin/dvc100

# --- Application macOS ------------------------------------------------
# Swift Package Manager produit un executable ; on l'emballe a la main dans
# un bundle .app pour que macOS lui accorde une identite (icone dans le Dock,
# autorisation micro pour la capture audio).

app: $(BIN)
	swift build -c release --package-path app
	@rm -rf $(APP_BUNDLE)
	@mkdir -p $(APP_BUNDLE)/Contents/MacOS $(APP_BUNDLE)/Contents/Resources
	@cp app/Info.plist $(APP_BUNDLE)/Contents/Info.plist
	@cp app/.build/release/$(APP_NAME) $(APP_BUNDLE)/Contents/MacOS/$(APP_NAME)
	@cp $(BIN) $(APP_BUNDLE)/Contents/Resources/dvc100
	@codesign --force --deep --sign - $(APP_BUNDLE) 2>/dev/null || \
		echo "(signature ad-hoc impossible, l'app fonctionnera quand meme en local)"
	@echo "==> $(APP_BUNDLE) construit. Ouvrez-le avec : open $(APP_BUNDLE)"

clean:
	rm -rf $(BUILD) app/.build
