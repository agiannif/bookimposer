# Entry point for all dev actions. Run `make` (or `make help`) to list targets.

SHELL := bash
.SHELLFLAGS := -eo pipefail -c

RUSTUP_BIN ?= /home/linuxbrew/.linuxbrew/opt/rustup/bin
export PATH := $(RUSTUP_BIN):$(PATH)
export BOOKCOMPOSER_PDFIUM_DIR ?= $(CURDIR)/vendor/pdfium/lib
PDFIUM_LIB := $(if $(filter Darwin,$(shell uname -s)),libpdfium.dylib,libpdfium.so)

.DEFAULT_GOAL := help
.PHONY: help layout-fixtures fetch-pdfium test test-engine test-export e2e typecheck lint fmt build release require-pdfium

help: ## List targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-16s %s\n", $$1, $$2}'

FIXTURES := ../crates/pdf-export/tests/data
FIXTURE_TMP := $(CURDIR)/target/layout-fixture.json.tmp

layout-fixtures: ## Regenerate checked-in Layout JSON fixtures
# Each fixture is written to a temp file under target/ and moved into place,
# so a failing command leaves the checked-in fixture untouched.
	mkdir -p $(dir $(FIXTURE_TMP))
	cd engine && node --input-type=module -e "import { workedExample } from './test/fixtures.ts'; process.stdout.write(JSON.stringify(workedExample()))" \
		| node bin/impose.ts > $(FIXTURE_TMP) && mv $(FIXTURE_TMP) $(FIXTURES)/worked-example.layout.json
	cd engine && node --input-type=module -e "import { workedExample } from './test/fixtures.ts'; const s = workedExample(); s.print.sheet.width = NaN; process.stdout.write(JSON.stringify(s))" \
		| node bin/impose.ts > $(FIXTURE_TMP) && mv $(FIXTURE_TMP) $(FIXTURES)/nan-sheet.layout.json
	cd engine && node --input-type=module -e "process.stdout.write(JSON.stringify({ pageSizes: Array.from({ length: 8 }, () => ({ width: 288, height: 378 })), parts: [{ type: 'body', signatures: 1, folds: 1 }], print: { sheet: { width: 576, height: 756 }, duplex: 'long-edge', margin: 0, gap: 0, bleed: 0 }, mismatch: 'fit' }))" \
		| node bin/impose.ts > $(FIXTURE_TMP) && mv $(FIXTURE_TMP) $(FIXTURES)/full-bleed-sheet.layout.json
	cd engine && node --input-type=module -e "process.stdout.write(JSON.stringify({ pageSizes: Array.from({ length: 16 }, () => ({ width: 288, height: 378 })), parts: [{ type: 'body', signatures: 1, folds: 2 }], print: { sheet: { width: 1300, height: 850 }, duplex: 'short-edge', margin: 18, gap: 18, bleed: 9 }, mismatch: 'fit' }))" \
		| node bin/impose.ts > $(FIXTURE_TMP) && mv $(FIXTURE_TMP) $(FIXTURES)/bleed-sheet.layout.json

fetch-pdfium: ## Download the PDFium library into vendor/pdfium
	scripts/fetch-pdfium

test: test-engine test-export ## Run all tests

test-engine: ## Run the TypeScript engine tests
	cd engine && npm test

test-export: require-pdfium ## Run the pdf-export crate tests (needs PDFium)
	cargo test -p pdf-export

e2e: require-pdfium ## Run the end-to-end impose-pdf test
	cargo test -p pdf-export --test cli impose_pdf

typecheck: ## Typecheck the TypeScript engine
	cd engine && npm run typecheck

lint: ## Check Rust formatting and run clippy
	cargo fmt --check
	cargo clippy -p pdf-export --all-targets -- -D warnings

fmt: ## Format Rust code
	cargo fmt

build: ## Build the pdf-export crate
	cargo build -p pdf-export

release: ## Build the release export binary
	cargo build --release -p pdf-export

require-pdfium:
	@test -f "$(BOOKCOMPOSER_PDFIUM_DIR)/$(PDFIUM_LIB)" || { echo "PDFium not found in $(BOOKCOMPOSER_PDFIUM_DIR). Run 'make fetch-pdfium' first." >&2; exit 1; }
