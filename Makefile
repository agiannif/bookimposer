# Entry point for all dev actions. Run `make` (or `make help`) to list targets.

SHELL := bash
.SHELLFLAGS := -eo pipefail -c

RUSTUP_BIN ?= /home/linuxbrew/.linuxbrew/opt/rustup/bin
export PATH := $(RUSTUP_BIN):$(PATH)
export BOOKCOMPOSER_PDFIUM_DIR ?= $(CURDIR)/vendor/pdfium/lib
export PLAYWRIGHT_BROWSERS_PATH := $(CURDIR)/app/.playwright-browsers
PDFIUM_LIB := $(if $(filter Darwin,$(shell uname -s)),libpdfium.dylib,libpdfium.so)

.DEFAULT_GOAL := help
.PHONY: help layout-fixtures fetch-pdfium test test-engine test-export e2e typecheck lint fmt build release require-pdfium app-dev app-test app-check app-e2e app-browsers app-fixtures app-screenshots export-size-probe tauri-check tauri-test ipc-fixtures

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
	cd engine && node --input-type=module -e "process.stdout.write(JSON.stringify({ pageSizes: Array.from({ length: 40 }, () => ({ width: 288, height: 378 })), parts: [{ type: 'body', signatures: 5, folds: 1 }], print: { sheet: { width: 612, height: 792 }, duplex: 'long-edge', margin: 18, gap: 0, bleed: 0 }, mismatch: 'fit' }))" \
		| node bin/impose.ts > $(FIXTURE_TMP) && mv $(FIXTURE_TMP) $(FIXTURES)/shared-resources.layout.json

fetch-pdfium: ## Download the PDFium library into vendor/pdfium
	scripts/fetch-pdfium

test: test-engine test-export app-test tauri-test ## Run all tests

test-engine: ## Run the TypeScript engine tests
	cd engine && npm test

test-export: require-pdfium ## Run the pdf-export crate tests (needs PDFium)
	cargo test -p pdf-export

e2e: require-pdfium ## Run the end-to-end impose-pdf test
	cargo test -p pdf-export --test cli impose_pdf

app-dev: ## Run the app dev server on 127.0.0.1:5173
	@echo "Open http://127.0.0.1:5173. From a remote box: ssh -L 5173:127.0.0.1:5173 <host>"
	cd app && npm run dev

app-test: ## Run the app unit tests
	cd app && npm test

app-check: ## Typecheck the app (svelte-check and tsc)
	cd app && npm run check

app-fixtures: require-pdfium ## Regenerate the app's test PDFs
	cargo run --quiet -p pdf-export --example make_app_fixtures -- $(CURDIR)/app/e2e/fixtures

export-size-probe: require-pdfium ## Export a PAGES-page book (default 300) whose pages share one image into OUT=dir; print sizes and time
	@test -n "$(OUT)" || { echo "Usage: make export-size-probe OUT=dir [PAGES=300] [SIGNATURES=19]" >&2; exit 2; }
	mkdir -p $(OUT)
	cargo run --quiet --release -p pdf-export --example shared_resource_book -- $(or $(PAGES),300) $(OUT)/book.pdf
	cargo build --quiet --release -p pdf-export
	start=$$(date +%s%N); \
		scripts/impose-pdf --input $(OUT)/book.pdf --output $(OUT)/sheets.pdf --signatures $(or $(SIGNATURES),19); \
		end=$$(date +%s%N); \
		echo "source $$(stat -c %s $(OUT)/book.pdf) bytes, sheets $$(stat -c %s $(OUT)/sheets.pdf) bytes, impose-pdf $$(( (end - start) / 1000000 )) ms"

app-screenshots: ## Screenshot start, setup and workspace into OUT=dir at 1280x800 and 1100x700 (needs 'make app-dev' running)
	@test -n "$(OUT)" || { echo "Usage: make app-screenshots OUT=dir" >&2; exit 2; }
	cd app && node scripts/screenshot-workspace.ts $(abspath $(OUT))

app-browsers: ## Download Playwright's Chromium into app/.playwright-browsers
	cd app && npx playwright install chromium

app-e2e: ## Run the app browser tests (needs 'make app-browsers')
	cd app && npm run e2e

tauri-check: ## Compile the Tauri app
	cargo check -p bookcomposer-app

ipc-fixtures: ## Regenerate the golden Tauri IPC frames (after a deliberate wire format change)
	cd app && node test/make-ipc-fixtures.ts

tauri-test: require-pdfium ## Test the Tauri app's commands (needs PDFium)
	cargo test -p bookcomposer-app

typecheck: ## Typecheck the TypeScript engine
	cd engine && npm run typecheck

lint: ## Check Rust formatting and run clippy
	cargo fmt --check
	cargo clippy -p pdf-export -p bookcomposer-app --all-targets -- -D warnings

fmt: ## Format Rust code
	cargo fmt

build: ## Build the pdf-export crate
	cargo build -p pdf-export

release: ## Build the release export binary
	cargo build --release -p pdf-export

require-pdfium:
	@test -f "$(BOOKCOMPOSER_PDFIUM_DIR)/$(PDFIUM_LIB)" || { echo "PDFium not found in $(BOOKCOMPOSER_PDFIUM_DIR). Run 'make fetch-pdfium' first." >&2; exit 1; }
