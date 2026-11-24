//! Writes a whole Layout: every sheet as a front page and a back page, with
//! each placement's source page embedded by [`embed::place`].

use crate::group::Carried;
use crate::layout::{Layout, SheetSide};
use crate::{ExportError, PageBoxes, dedupe, embed, group, load_pdf, marks, page_boxes, timing};
use lopdf::xref::XrefEntry;
use pdfium_render::prelude::*;
use std::collections::BTreeSet;

/// What to draw besides the pages: each side's cut and fold marks, front
/// and back, as the Layout places them.
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
    let output = timing::stage("export.total", || {
        export_timed(pdfium, source, layout, options)
    });
    timing::report_totals();
    output
}

fn export_timed(
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
    let source = timing::stage("export.source_load", || load_pdf(pdfium, source))?;
    let boxes = timing::stage("export.page_boxes", || page_boxes(&source))?;
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
    timing::stage("export.annotation_scan", || -> Result<(), ExportError> {
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
        Ok(())
    })?;

    let mut sheets = pdfium.create_new_pdf()?;
    timing::stage("export.embed", || -> Result<(), ExportError> {
        for (index, sheet) in layout.sheets.iter().enumerate() {
            for (side_number, side) in [&sheet.front, &sheet.back].into_iter().enumerate() {
                let fields = [
                    ("sheet", index),
                    ("back", side_number),
                    ("placements", side.placements.len()),
                ];
                timing::stage_with(
                    "export.embed_side",
                    &fields,
                    || -> Result<(), ExportError> {
                        let mut page =
                            write_side(pdfium, &mut sheets, &source, &boxes, layout, side)?;
                        timing::accumulate("export.marks", || {
                            marks::draw_marks(
                                &sheets,
                                &mut page,
                                &side.marks,
                                &layout.mark_style,
                                &layout.sheet,
                                options.cut_marks,
                                options.fold_marks,
                            )
                        })?;
                        Ok(())
                    },
                )?;
            }
        }
        Ok(())
    })?;
    let saved = timing::stage("export.pdfium_save", || sheets.save_to_bytes())?;
    let pdf = timing::stage("export.rewrite", || {
        rewrite(source_bytes, saved, layout, &mut warnings)
    })?;
    Ok(ExportOutput { pdf, warnings })
}

/// PDFium's output `pdf` with the page groups carried over and identical
/// objects shared, in one lopdf load and save. When neither changes
/// anything, `pdf` is returned as PDFium wrote it.
fn rewrite(
    source: &[u8],
    pdf: Vec<u8>,
    layout: &Layout,
    warnings: &mut Vec<String>,
) -> Result<Vec<u8>, ExportError> {
    let rewrite_error = |error: &dyn std::error::Error| ExportError::Rewrite(error.to_string());
    // Strict: lenient loading skips an object it cannot parse and rebuilds a
    // damaged cross-reference table, so content could vanish from the output
    // without an error.
    let strict = lopdf::LoadOptions {
        strict: true,
        ..Default::default()
    };
    let mut output = timing::stage("rewrite.lopdf_load", || {
        lopdf::Document::load_mem_with_options(&pdf, strict)
    })
    .map_err(|e| rewrite_error(&e))?;
    let missing = timing::stage("rewrite.missing_objects", || missing_objects(&output));
    if !missing.is_empty() {
        return Err(ExportError::Rewrite(format!(
            "objects {missing:?} of PDFium's output did not load"
        )));
    }
    // A source lopdf cannot read skips the groups rather than failing an
    // export PDFium managed.
    let carried = timing::stage("rewrite.carry_groups", || {
        group::carry_page_groups(source, &mut output, layout)
    })?;
    if let Carried::SourceUnreadable(error) = &carried {
        warnings.push(format!(
            "could not read the source's page transparency groups ({error}); \
             pages are placed without them"
        ));
    }
    let removed = timing::stage("rewrite.dedupe", || {
        dedupe::share_identical_objects(&mut output)
    });
    if carried != Carried::Added && removed == 0 {
        return Ok(pdf);
    }
    let mut bytes = Vec::new();
    timing::stage("rewrite.lopdf_save", || output.save_to(&mut bytes))
        .map_err(|e| rewrite_error(&e))?;
    Ok(bytes)
}

/// The objects `doc`'s cross-reference table lists as in use that loading
/// left out. Empty for a complete load.
fn missing_objects(doc: &lopdf::Document) -> Vec<lopdf::ObjectId> {
    doc.reference_table
        .entries
        .iter()
        .filter_map(|(&number, entry)| match *entry {
            XrefEntry::Normal { generation, .. } => Some((number, generation)),
            XrefEntry::Compressed { .. } => Some((number, 0)),
            XrefEntry::Free | XrefEntry::UnusableFree => None,
        })
        .filter(|id| !doc.objects.contains_key(id))
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Document, ObjectId, dictionary};

    /// A one-page PDF whose catalog also references a `<</Marker 12345>>`
    /// object, saved by lopdf.
    fn pdf_with_marker() -> Vec<u8> {
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let page = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages,
            "MediaBox" => vec![0.into(), 0.into(), 100.into(), 100.into()],
        });
        doc.objects.insert(
            pages,
            dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 }.into(),
        );
        let marker = doc.add_object(dictionary! { "Marker" => 12345 });
        let catalog = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages,
            "Extra" => marker,
        });
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    fn empty_layout() -> Layout {
        let mut layout =
            crate::layout::parse(include_str!("../tests/data/worked-example.layout.json")).unwrap();
        layout.sheets.clear();
        layout
    }

    fn replace_once(bytes: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
        assert_eq!(from.len(), to.len(), "keeps every xref offset valid");
        let at = bytes
            .windows(from.len())
            .position(|w| w == from)
            .expect("pattern in the PDF");
        let mut out = bytes.to_vec();
        out[at..at + from.len()].copy_from_slice(to);
        out
    }

    #[test]
    fn an_object_lopdf_cannot_parse_fails_the_rewrite() {
        let pdf = replace_once(&pdf_with_marker(), b"/Marker 12345>>", b"/Marker 12345]]");

        let result = rewrite(&pdf, pdf.clone(), &empty_layout(), &mut Vec::new());

        assert!(
            matches!(result, Err(ExportError::Rewrite(_))),
            "{:?}",
            result.map(|bytes| bytes.len())
        );
    }

    #[test]
    fn an_in_use_object_missing_after_loading_is_reported() {
        let mut doc = Document::load_mem(&pdf_with_marker()).unwrap();
        assert_eq!(missing_objects(&doc), Vec::<ObjectId>::new());
        let marker = *doc
            .objects
            .keys()
            .find(|id| doc.objects[id].as_dict().is_ok_and(|d| d.has(b"Marker")))
            .unwrap();
        doc.objects.remove(&marker);

        assert_eq!(missing_objects(&doc), vec![marker]);
    }
}
