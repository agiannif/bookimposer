//! Writes a whole Layout: every sheet as a front page and a back page, with
//! each placement's source page embedded by [`embed::place`].

use crate::group::Carried;
use crate::layout::{Layout, SheetSide};
use crate::{ExportError, PageBoxes, embed, group, load_pdf, marks, page_boxes};
use pdfium_render::prelude::*;
use std::collections::BTreeSet;

/// What to draw besides the pages.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ExportOptions {
    pub cut_marks: bool,
    pub fold_marks: bool,
}

/// An exported sheets PDF and what the user should know about it.
#[derive(Debug)]
pub struct ExportOutput {
    pub pdf: Vec<u8>,
    pub warnings: Vec<String>,
}

/// Imposes the PDF in `source` onto sheets as `layout` places its pages.
/// The output holds sheet 0 front, sheet 0 back, sheet 1 front and so on;
/// every sheet gets a back page, even a blank one, so duplex printing stays
/// aligned.
pub fn export(
    pdfium: &Pdfium,
    source: &[u8],
    layout: &Layout,
    options: &ExportOptions,
) -> Result<ExportOutput, ExportError> {
    let errors: Vec<String> = layout
        .issues
        .iter()
        .filter(|issue| issue.severity == "error")
        .map(|issue| issue.message.clone())
        .collect();
    if !errors.is_empty() {
        return Err(ExportError::LayoutHasErrors(errors));
    }

    let source_bytes = source;
    let source = load_pdf(pdfium, source)?;
    let boxes = page_boxes(&source)?;
    let sides = || layout.sheets.iter().flat_map(|s| [&s.front, &s.back]);
    if let Some(pdf_page) = sides()
        .flat_map(|side| &side.placements)
        .filter_map(|placement| placement.pdf_page)
        .find(|&pdf_page| pdf_page >= boxes.len())
    {
        return Err(ExportError::PageOutOfRange {
            pdf_page,
            page_count: boxes.len(),
        });
    }

    let mut warnings = Vec::new();
    let placed: BTreeSet<usize> = sides()
        .flat_map(|side| &side.placements)
        .filter_map(|placement| placement.pdf_page)
        .collect();
    for pdf_page in placed {
        // `export` checked every pdf_page against the page count, which
        // PDFium keeps within i32.
        let dropped = printed_annotations(&source.pages().get(pdf_page as i32)?);
        if dropped > 0 {
            warnings.push(format!(
                "page {} has {dropped} annotation(s) or form field(s) that are not included in the output",
                pdf_page + 1
            ));
        }
    }

    let mut sheets = pdfium.create_new_pdf()?;
    let marks_wanted = options.cut_marks || options.fold_marks;
    for (index, sheet) in layout.sheets.iter().enumerate() {
        let mut front = write_side(pdfium, &mut sheets, &source, &boxes, layout, &sheet.front)?;
        if marks_wanted {
            let drawn = marks::draw_marks(
                &sheets,
                &mut front,
                sheet,
                &layout.sheet,
                options.cut_marks,
                options.fold_marks,
            )?;
            let number = index + 1;
            if drawn.skipped > 0 {
                warnings.push(format!(
                    "skipped {} cut/fold line(s) on sheet {number} that are not horizontal or vertical",
                    drawn.skipped
                ));
            }
            if drawn.lines > 0 && drawn.ticks == 0 {
                warnings.push(format!(
                    "cut/fold marks would overlap page content on sheet {number}"
                ));
            }
        }
        write_side(pdfium, &mut sheets, &source, &boxes, layout, &sheet.back)?;
    }
    let mut pdf = sheets.save_to_bytes()?;
    // A source lopdf cannot read skips the groups rather than failing an
    // export PDFium managed.
    match group::carry_page_groups(source_bytes, &pdf, layout)? {
        Carried::Unchanged => {}
        Carried::Rewritten(with_groups) => pdf = with_groups,
        Carried::SourceUnreadable(error) => warnings.push(format!(
            "could not read the source's page transparency groups ({error}); \
             pages are placed without them"
        )),
    }
    Ok(ExportOutput { pdf, warnings })
}

/// How many of `page`'s annotations would show in print: those flagged to
/// print, and every form field. The export copies only page content, so
/// these are lost.
fn printed_annotations(page: &PdfPage) -> usize {
    page.annotations()
        .iter()
        .filter(|annotation| {
            annotation.is_printed()
                || matches!(
                    annotation.annotation_type(),
                    PdfPageAnnotationType::Widget | PdfPageAnnotationType::XfaWidget
                )
        })
        .count()
}

/// Appends one sheet-sized page to `sheets` holding `side`'s placements, and
/// returns it.
fn write_side<'a>(
    pdfium: &'a Pdfium,
    sheets: &mut PdfDocument<'a>,
    source: &PdfDocument<'a>,
    boxes: &[PageBoxes],
    layout: &Layout,
    side: &SheetSide,
) -> Result<PdfPage<'a>, ExportError> {
    let mut page = sheets
        .pages_mut()
        .create_page_at_end(PdfPagePaperSize::Custom(
            PdfPoints::new(layout.sheet.width as f32),
            PdfPoints::new(layout.sheet.height as f32),
        ))?;
    for placement in &side.placements {
        let Some(pdf_page) = placement.pdf_page else {
            continue;
        };
        // `export` checked every pdf_page against the page count, which
        // PDFium keeps within i32.
        let mut source_page = source.pages().get(pdf_page as i32)?;
        embed::place(
            pdfium,
            sheets,
            &mut page,
            &mut source_page,
            placement,
            &layout.sheet,
            &boxes[pdf_page].trim,
        )?;
    }
    Ok(page)
}
