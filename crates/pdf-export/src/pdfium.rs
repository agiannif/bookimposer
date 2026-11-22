//! Binding to the PDFium shared library.

pub use pdfium_render::prelude::Pdfium;
use pdfium_render::prelude::*;
use std::path::{Path, PathBuf};

/// Loads PDFium from `$BOOKCOMPOSER_PDFIUM_DIR`, or by default from
/// `<repo>/vendor/pdfium/lib`, where `scripts/fetch-pdfium` puts it.
///
/// PDFium can be bound only once per process: a second call returns
/// `PdfiumError::PdfiumLibraryBindingsAlreadyInitialized`, so callers keep and
/// share the first `Pdfium`.
pub fn load() -> Result<Pdfium, PdfiumError> {
    load_with_default(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vendor/pdfium/lib"))
}

/// Loads PDFium from `$BOOKCOMPOSER_PDFIUM_DIR`, or from `default_dir` when it
/// is unset. Binds once per process, as [`load`] does.
pub fn load_with_default(default_dir: &Path) -> Result<Pdfium, PdfiumError> {
    let dir = std::env::var_os("BOOKCOMPOSER_PDFIUM_DIR")
        .map_or_else(|| default_dir.to_path_buf(), PathBuf::from);
    let library = Pdfium::pdfium_platform_library_name_at_path(&dir);
    Pdfium::bind_to_library(library).map(Pdfium::new)
}
