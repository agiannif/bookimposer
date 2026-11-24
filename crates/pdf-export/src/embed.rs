//! Places one source page on a sheet page: transformed into its content box
//! and clipped to its clip rect, as nested form XObjects.

use crate::geometry::{PdfBox, displayed_box, placement_matrix, to_pdf_rect};
use crate::layout::{PagePlacement, Size};
use crate::{ExportError, page_rotation, timing};
use pdfium_render::prelude::*;

/// Draws `source_page` onto `sheet_page` so its `trim` box fills
/// `placement.content`, turned by `placement.rotation`, with everything
/// outside `placement.clip` cut away. The page is placed as it displays, its
/// own /Rotate applied before `placement.rotation`; `trim` is the box as the
/// page dictionary stores it, before that /Rotate. Page content is copied,
/// never rasterized.
///
/// PDFium has no per-object clip, so the source page first goes onto a
/// clip-sized page in a scratch document, whose own bounds do the clipping;
/// that page is then copied onto the sheet as one form XObject. The scratch
/// document is dropped afterwards, so the sheet document gains only that
/// XObject and what it references.
pub fn place<'a>(
    pdfium: &'a Pdfium,
    sheet_doc: &mut PdfDocument<'a>,
    sheet_page: &mut PdfPage<'a>,
    source_page: &mut PdfPage<'a>,
    placement: &PagePlacement,
    sheet: &Size,
    trim: &PdfBox,
) -> Result<(), ExportError> {
    timing::accumulate("embed.place", || {
        place_page(
            pdfium,
            sheet_doc,
            sheet_page,
            source_page,
            placement,
            sheet,
            trim,
        )
    })
}

fn place_page<'a>(
    pdfium: &'a Pdfium,
    sheet_doc: &mut PdfDocument<'a>,
    sheet_page: &mut PdfPage<'a>,
    source_page: &mut PdfPage<'a>,
    placement: &PagePlacement,
    sheet: &Size,
    trim: &PdfBox,
) -> Result<(), ExportError> {
    let clip = to_pdf_rect(&placement.clip, sheet);
    let content = to_pdf_rect(&placement.content, sheet);

    let mut scratch = timing::accumulate("embed.create_scratch", || pdfium.create_new_pdf())?;
    // `objects_mut` only because `objects` ties the copy's lifetime to this
    // borrow of the page; nothing on the page is modified.
    let mut page_xobject = timing::accumulate("embed.copy_page_to_scratch", || {
        source_page
            .objects_mut()
            .copy_into_x_object_form_object(&mut scratch)
    })?;
    // PDFium's copy already shows the page as it displays (see
    // `displayed_box`), so the trim is fitted in that space.
    let page_box: PdfBox = source_page.boundaries().bounding()?.bounds.into();
    let trim = displayed_box(trim, &page_box, page_rotation(source_page)?);
    let [a, b, c, d, e, f] = placement_matrix(&trim, &content, placement.rotation);
    page_xobject.apply_matrix(PdfMatrix::new(a, b, c, d, e - clip.left, f - clip.bottom))?;

    let mut clip_page = scratch
        .pages_mut()
        .create_page_at_end(PdfPagePaperSize::Custom(
            PdfPoints::new(clip.width),
            PdfPoints::new(clip.height),
        ))?;
    clip_page.objects_mut().add_object(page_xobject)?;

    let mut clipped = timing::accumulate("embed.copy_clip_page_to_sheet", || {
        clip_page
            .objects_mut()
            .copy_into_x_object_form_object(sheet_doc)
    })?;
    clipped.translate(PdfPoints::new(clip.left), PdfPoints::new(clip.bottom))?;
    sheet_page.objects_mut().add_object(clipped)?;
    Ok(())
}
