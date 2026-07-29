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

.PHONY: all app clean install uninstall check doctor

all: $(BIN)

# Etat de l'environnement, a copier-coller en cas de probleme.
doctor:
	@echo "--- Environnement ---"
	@echo "macOS       : $$(sw_vers -productVersion 2>/dev/null)"
	@echo "Processeur  : $$(uname -m)"
	@echo "Xcode actif : $$(xcode-select -p 2>&1)"
	@echo "swiftc      : $$(xcrun --find swiftc 2>&1)"
	@echo "SDK macOS   : $$(xcrun --show-sdk-path --sdk macosx 2>&1)"
	@echo "Swift       : $$(xcrun swiftc --version 2>&1 | head -1)"
	@echo "Homebrew    : $$(command -v brew || echo absent)"
	@echo "libusb      : $$($(PKG_CONFIG) --modversion libusb-1.0 2>/dev/null || echo absent)"
	@echo "ffmpeg      : $$(command -v ffmpeg || echo absent)"
	@echo "dvc100      : $$([ -x $(BIN) ] && echo construit || echo 'pas encore construit')"
	@echo "app         : $$([ -d $(APP_BUNDLE) ] && echo construite || echo 'pas encore construite')"

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
# On appelle swiftc directement plutot que Swift Package Manager : SwiftPM
# doit d'abord compiler son manifeste (module PackageDescription), qui manque
# dans certaines installations des Command Line Tools et fait echouer la
# construction avec "Invalid manifest". Le compilateur, lui, suffit.

SWIFT_SRCS := $(wildcard app/Sources/VHSRecorder/*.swift)
MACOS_MIN  := 12.0
ARCH       := $(shell uname -m)

app: $(BIN)
	@command -v xcrun >/dev/null 2>&1 || { \
		echo "xcrun introuvable : lancez 'xcode-select --install'"; exit 1; }
	@rm -rf $(APP_BUNDLE)
	@mkdir -p $(APP_BUNDLE)/Contents/MacOS $(APP_BUNDLE)/Contents/Resources
	@echo "Compilation de l'interface : comptez une a trois minutes, sans"
	@echo "aucun affichage pendant ce temps. C'est normal, laissez tourner."
	@echo "Si rien n'a abouti au bout de dix minutes, Ctrl-C et signalez-le :"
	@echo "les avertissements ci-dessous designent les expressions trop lentes."
	@# Pas de -O : l'optimiseur triple le temps de compilation pour un gain
	@# nul ici, tout le travail lourd etant fait par dvc100 et ffmpeg.
	xcrun swiftc -swift-version 5 -parse-as-library \
		-Xfrontend -warn-long-function-bodies=2000 \
		-Xfrontend -warn-long-expression-type-checking=2000 \
		-sdk "$$(xcrun --show-sdk-path --sdk macosx)" \
		-target $(ARCH)-apple-macos$(MACOS_MIN) \
		-framework SwiftUI -framework AppKit \
		-framework CoreImage -framework CoreVideo \
		-o $(APP_BUNDLE)/Contents/MacOS/$(APP_NAME) \
		$(SWIFT_SRCS)
	@cp app/Info.plist $(APP_BUNDLE)/Contents/Info.plist
	@cp $(BIN) $(APP_BUNDLE)/Contents/Resources/dvc100
	@codesign --force --deep --sign - $(APP_BUNDLE) 2>/dev/null || \
		echo "(signature ad-hoc impossible, l'app fonctionnera quand meme en local)"
	@echo "==> $(APP_BUNDLE) construit. Ouvrez-le avec : open $(APP_BUNDLE)"

clean:
	rm -rf $(BUILD) app/.build
