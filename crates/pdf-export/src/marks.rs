//! Draws a side's cut and fold marks: the tick segments the engine placed in
//! the Layout (`SideMarks`), each stroked in its kind's style.

use crate::ExportError;
use crate::layout::{MarkStyle, SheetLine, SideMarks, Size};
use pdfium_render::prelude::*;

/// Draws `marks` on `page`, a sheet side sized as `size`, in `style`: the
/// cut ticks (solid) when `cut_marks`, the fold ticks (dashed as the style
/// says for the spine or for a fold that opens by trim) when `fold_marks`.
pub fn draw_marks<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    marks: &SideMarks,
    style: &MarkStyle,
    size: &Size,
    cut_marks: bool,
    fold_marks: bool,
) -> Result<(), ExportError> {
    if cut_marks {
        for tick in &marks.cut {
            draw_tick(document, page, tick, style.stroke_width, &[], size)?;
        }
    }
    if fold_marks {
        for fold in &marks.fold {
            let tick = SheetLine {
                x1: fold.x1,
                y1: fold.y1,
                x2: fold.x2,
                y2: fold.y2,
            };
            let dash = if fold.opens_by_trim {
                &style.dash.opens_by_trim
            } else {
                &style.dash.spine
            };
            draw_tick(document, page, &tick, style.stroke_width, dash, size)?;
        }
    }
    Ok(())
}

/// Strokes `tick`, solid when `dash` is empty.
fn draw_tick<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    tick: &SheetLine,
    width: f64,
    dash: &[f64],
    size: &Size,
) -> Result<(), ExportError> {
    // Layout y runs down from the top; PDF y runs up from the bottom.
    let mut path = PdfPagePathObject::new_line(
        document,
        PdfPoints::new(tick.x1 as f32),
        PdfPoints::new((size.height - tick.y1) as f32),
        PdfPoints::new(tick.x2 as f32),
        PdfPoints::new((size.height - tick.y2) as f32),
        PdfColor::BLACK,
        PdfPoints::new(width as f32),
    )?;
    if !dash.is_empty() {
        let pattern: Vec<PdfPoints> = dash.iter().map(|&len| PdfPoints::new(len as f32)).collect();
        path.set_dash_array(&pattern, PdfPoints::ZERO)?;
    }
    page.objects_mut().add_path_object(path)?;
    Ok(())
}
