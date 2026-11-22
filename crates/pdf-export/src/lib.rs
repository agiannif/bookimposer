//! Embeds source PDF pages onto printed sheets as form XObjects, without
//! rasterizing or re-encoding any page content.

pub mod embed;
pub mod geometry;
pub mod group;
pub mod layout;
pub mod marks;
pub mod pdfium;
pub mod sheets;

pub use sheets::{ExportOptions, ExportOutput, export};

use geometry::PdfBox;
use pdfium_render::prelude::*;
use serde::Serialize;
use std::fmt;

/// Why an export failed.
#[derive(Debug)]
pub enum ExportError {
    /// PDFium reported an error.
    Pdfium(String),
    /// The input is not a PDF file, or is too damaged to open.
    NotAPdf,
    /// The input PDF needs a password to open.
    PasswordProtected,
    /// A file could not be read; holds the path and the I/O error.
    CannotRead(String),
    /// The Layout reports errors, so there is nothing valid to export; holds
    /// the error issues' messages.
    LayoutHasErrors(Vec<String>),
    /// The page transparency groups could not be added to the output.
    PageGroups(String),
    /// The Layout places 0-based page `pdf_page`, but the source PDF has only
    /// `page_count` pages.
    PageOutOfRange { pdf_page: usize, page_count: usize },
}

impl fmt::Display for ExportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExportError::Pdfium(message) => write!(f, "PDFium error: {message}"),
            ExportError::NotAPdf => write!(f, "not a PDF or the file is damaged"),
            ExportError::PasswordProtected => write!(
                f,
                "the PDF is password-protected; remove the password and try again"
            ),
            ExportError::CannotRead(what) => write!(f, "cannot read {what}"),
            ExportError::PageGroups(message) => {
                write!(f, "could not carry page transparency groups: {message}")
            }
            ExportError::LayoutHasErrors(messages) => write!(
                f,
                "the layout has errors; fix the book settings and impose again: {}",
                messages.join("; ")
            ),
            ExportError::PageOutOfRange {
                pdf_page,
                page_count,
            } => write!(
                f,
                "the layout places page {} but the input PDF has only {page_count} pages; \
                 was the layout made for a different PDF?",
                pdf_page + 1
            ),
        }
    }
}

impl std::error::Error for ExportError {}

impl From<pdfium_render::prelude::PdfiumError> for ExportError {
    fn from(error: pdfium_render::prelude::PdfiumError) -> Self {
        ExportError::Pdfium(error.to_string())
    }
}

/// The boxes of one source page, as the page dictionary stores them, and the
/// page's /Rotate, which turns them for display.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBoxes {
    /// The TrimBox, or the CropBox when the page defines none (which is the
    /// MediaBox when the page defines no CropBox either).
    pub trim: PdfBox,
    /// The CropBox clipped to the MediaBox, or the MediaBox when the page
    /// defines no CropBox.
    pub crop: PdfBox,
    pub media: PdfBox,
    /// The BleedBox; `None` when the page defines none.
    pub bleed: Option<PdfBox>,
    /// The page's /Rotate in degrees clockwise: 0, 90, 180 or 270.
    pub rotation: u16,
}

impl PageBoxes {
    /// The trim's `(width, height)` as the page displays, swapped when its
    /// /Rotate turns it a quarter.
    pub fn displayed_trim_size(&self) -> (f32, f32) {
        if self.rotation.is_multiple_of(180) {
            (self.trim.width, self.trim.height)
        } else {
            (self.trim.height, self.trim.width)
        }
    }
}

/// The boxes and /Rotate of every page of the PDF in `source`.
pub fn page_sizes(pdfium: &Pdfium, source: &[u8]) -> Result<Vec<PageBoxes>, ExportError> {
    page_boxes(&load_pdf(pdfium, source)?)
}

/// Opens the PDF in `source`, reporting a non-PDF or damaged input as
/// `NotAPdf` and one that needs a password as `PasswordProtected`.
fn load_pdf<'a>(pdfium: &'a Pdfium, source: &'a [u8]) -> Result<PdfDocument<'a>, ExportError> {
    pdfium
        .load_pdf_from_byte_slice(source, None)
        .map_err(|error| match error {
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::FormatError) => {
                ExportError::NotAPdf
            }
            PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
                ExportError::PasswordProtected
            }
            other => other.into(),
        })
}

/// The boxes and /Rotate of every page of `document`.
fn page_boxes(document: &PdfDocument) -> Result<Vec<PageBoxes>, ExportError> {
    document
        .pages()
        .iter()
        .map(|page| {
            let boundaries = page.boundaries();
            let media: PdfBox = boundaries.media()?.bounds.into();
            // PDFium's page bounding box is the page's effective CropBox: the
            // /CropBox clipped to the MediaBox, or the MediaBox when there is
            // no /CropBox.
            let crop: PdfBox = boundaries.bounding()?.bounds.into();
            // PDFium reads /TrimBox and /BleedBox straight from the page
            // dictionary and fails when the key is absent, with no fallback
            // to another box; so an error here means "not defined".
            let trim = boundaries.trim().map_or(crop, |b| b.bounds.into());
            let bleed = boundaries.bleed().ok().map(|b| b.bounds.into());
            Ok(PageBoxes {
                trim,
                crop,
                media,
                bleed,
                rotation: page_rotation(&page)?,
            })
        })
        .collect()
}

/// The page's /Rotate in degrees clockwise.
pub(crate) fn page_rotation(page: &PdfPage) -> Result<u16, ExportError> {
    Ok(match page.rotation()? {
        PdfPageRenderRotation::None => 0,
        PdfPageRenderRotation::Degrees90 => 90,
        PdfPageRenderRotation::Degrees180 => 180,
        PdfPageRenderRotation::Degrees270 => 270,
    })
}
