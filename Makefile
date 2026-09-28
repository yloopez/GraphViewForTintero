# Graph View for Tintero — build and packaging
#
#   make            validate, test, then build dist/plugin.zip
#   make check      validate the manifest and sources only
#   make test       run the plugin against a fake host (small and empty project)
#   make test-big   time the layout on a ~1000-node project
#   make package    same as make
#   make verify     list what ended up inside the zip
#   make clean      remove dist/
#
# Install the result with Settings -> Plugins -> Load local plugin (dev).

SRC       := src
DIST      := dist
STAGE     := $(DIST)/stage
ZIP       := $(DIST)/plugin.zip

# Only these extensions survive installation, so only these are packaged.
FILES     := plugin.json plugin.js plugin.css icon.svg
SOURCES   := $(addprefix $(SRC)/,$(FILES))

.DEFAULT_GOAL := package
.PHONY: package check test test-big verify clean help

help:
	@echo "make          validate, test, and build $(ZIP)"
	@echo "make check    validate the manifest and sources"
	@echo "make test     run the plugin against a fake host"
	@echo "make test-big time the layout on a ~1000-node project"
	@echo "make package  build $(ZIP)"
	@echo "make verify   list the contents of $(ZIP)"
	@echo "make clean    remove $(DIST)/"

check:
	@node tools/validate.js

test:
	@node tools/harness.js > /dev/null && echo "ok  small project"
	@EMPTY=1 node tools/harness.js > /dev/null && echo "ok  empty project"

test-big:
	@BIG=1 node tools/harness.js | grep -E "frames|status:"

package: check test $(ZIP)

# Staged rather than zipped in place so the archive contains exactly the four
# files the installer will keep, with no stray dotfiles.
$(ZIP): $(SOURCES) Makefile
	@rm -rf $(STAGE)
	@mkdir -p $(STAGE)
	@cp $(SOURCES) $(STAGE)/
	@rm -f $@
	@if command -v zip >/dev/null 2>&1; then \
		(cd $(STAGE) && zip -FSrq ../plugin.zip .); \
	elif command -v powershell >/dev/null 2>&1; then \
		powershell -NoProfile -NonInteractive -Command \
			"Compress-Archive -Path '$(CURDIR)/$(STAGE)/*' -DestinationPath '$(CURDIR)/$@' -Force"; \
	else \
		echo "need either 'zip' or 'powershell' to build the archive" >&2; exit 1; \
	fi
	@rm -rf $(STAGE)
	@echo "built $@"

verify: $(ZIP)
	@if command -v unzip >/dev/null 2>&1; then \
		unzip -l $(ZIP); \
	else \
		powershell -NoProfile -NonInteractive -Command \
			"Add-Type -AssemblyName System.IO.Compression.FileSystem; \
			 [IO.Compression.ZipFile]::OpenRead('$(CURDIR)/$(ZIP)').Entries | \
			 Select-Object Length, FullName | Format-Table -AutoSize"; \
	fi

clean:
	@rm -rf $(DIST)
	@echo "removed $(DIST)/"
