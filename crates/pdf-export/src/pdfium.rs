//! Binding to the PDFium shared library.

use pdfium_render::prelude::*;
use std::path::PathBuf;

/// Directory holding the PDFium library. `$BOOKCOMPOSER_PDFIUM_DIR` overrides
/// the default of `<repo>/vendor/pdfium/lib`, where `scripts/fetch-pdfium` puts it.
fn library_dir() -> PathBuf {
    match std::env::var_os("BOOKCOMPOSER_PDFIUM_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vendor/pdfium/lib"),
    }
}

/// Loads PDFium from [`library_dir`].
///
/// PDFium can be bound only once per process: a second call returns
/// `PdfiumError::PdfiumLibraryBindingsAlreadyInitialized`, so callers keep and
/// share the first `Pdfium`.
pub fn load() -> Result<Pdfium, PdfiumError> {
    let library = Pdfium::pdfium_platform_library_name_at_path(&library_dir());
    Pdfium::bind_to_library(library).map(Pdfium::new)
}
