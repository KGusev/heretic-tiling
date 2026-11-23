EXTENSION_UUID := heretic-tiling@kgusev-on-github
SOURCE_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))/$(EXTENSION_UUID)
DATA_HOME := $(if $(XDG_DATA_HOME),$(XDG_DATA_HOME),$(HOME)/.local/share)
EXTENSIONS_DIR ?= $(DATA_HOME)/gnome-shell/extensions
INSTALL_DIR := $(EXTENSIONS_DIR)/$(EXTENSION_UUID)

.DEFAULT_GOAL := install
.PHONY: install dev test test-unit test-native test-smoke style
.NOTPARALLEL:
.ONESHELL:
.SHELLFLAGS := -eu -c

define report_result
@green= red= reset=
if [ -t 2 ] && [ "$${TERM:-dumb}" != dumb ] && [ "$${NO_COLOR+x}" != x ]; then
    green=$$(printf '\033[32m'); red=$$(printf '\033[31m'); reset=$$(printf '\033[0m')
fi
trap 'status=$$?; if [ "$$status" -eq 0 ]; then printf "%sSuccess:%s make %s completed.\n" "$$green" "$$reset" "$@" >&2; else printf "%sFailed:%s make %s (exit %s). See the error above.\n" "$$red" "$$reset" "$@" "$$status" >&2; fi; exit "$$status"' 0
endef

# Replace only this extension; never remove the checkout itself.
define prepare_destination
	@mkdir -p "$(EXTENSIONS_DIR)"
	@if [ ! -L "$(INSTALL_DIR)" ] && [ "$$(realpath -m "$(INSTALL_DIR)")" = "$$(realpath "$(SOURCE_DIR)")" ]; then \
		echo "Refusing to replace the source directory" >&2; exit 1; \
	fi
	rm -rf -- "$(INSTALL_DIR)"
endef

install:
	$(report_result)
	glib-compile-schemas --strict --dry-run "$(SOURCE_DIR)/schemas"
	$(prepare_destination)
	cp -a "$(SOURCE_DIR)" "$(INSTALL_DIR)"
	glib-compile-schemas --strict "$(INSTALL_DIR)/schemas"

dev:
	$(report_result)
	glib-compile-schemas --strict "$(SOURCE_DIR)/schemas"
	$(prepare_destination)
	ln -s "$(SOURCE_DIR)" "$(INSTALL_DIR)"

# Supply the Mutter paths for your installed GNOME version when needed.
KITTY ?= kitty
PRETTIER ?= prettier
RUFF ?= ruff

style:
	$(report_result)
	command -v "$(PRETTIER)" >/dev/null || { echo "Prettier is required. See CONTRIBUTING.md for setup." >&2; exit 1; }
	command -v "$(RUFF)" >/dev/null || { echo "Ruff is required. See CONTRIBUTING.md for setup." >&2; exit 1; }
	"$(PRETTIER)" --write 'heretic-tiling@kgusev-on-github/**/*.{js,json,css}' 'tests/**/*.{js,mjs}'
	"$(RUFF)" format heretic-tiling@kgusev-on-github/helpers tests

test:
	$(report_result)
	$(MAKE) --no-print-directory -k test-unit test-native test-smoke

test-unit:
	$(report_result)
	glib-compile-schemas --strict "$(SOURCE_DIR)/schemas"
	status=0
	node --experimental-vm-modules --test tests/*.test.mjs || status=1
	python3 tests/window-click.test.py || status=1
	glib-compile-schemas --strict --dry-run "$(SOURCE_DIR)/schemas" || status=1
	exit $$status

test-native:
	$(report_result)
	status=0
	gjs -m tests/layout-native-rectangle.js || status=1
	gjs -m tests/window-shadows-native.js || status=1
	exit $$status

test-smoke:
	$(report_result)
	glib-compile-schemas --strict "$(SOURCE_DIR)/schemas"
	status=0
	python3 tests/gnome-layout-smoke.py || status=1
	for backend in wayland x11; do
	    backend_flag=
	    if [ "$$backend" = x11 ]; then backend_flag=--x11; fi
	    for mode in basic undecorated resize navigate workspace-layout; do
	        mode_flag=
	        if [ "$$mode" != basic ]; then mode_flag=--$$mode; fi
	        printf '\nRunning Kitty smoke test: %s / %s\n' "$$backend" "$$mode"
	        python3 tests/gnome-kitty-smoke.py "$(KITTY)" $$backend_flag $$mode_flag || status=1
	    done
	done
	exit $$status
