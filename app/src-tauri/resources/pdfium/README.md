# Bundled PDFium

The release build puts the PDFium library (`libpdfium.dylib` or
`libpdfium.so`) here, and the app loads it from this folder in its resources
when `BOOKCOMPOSER_PDFIUM_DIR` is not set. The library is not committed.

This README keeps the `resources/pdfium/*` resource entry in `tauri.conf.json`
matching at least one file, which `tauri-build` requires.
