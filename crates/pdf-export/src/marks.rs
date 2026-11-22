//! Cut and fold marks: short ticks drawn in the margins past the ends of
//! each line, never over a placement's clip rectangle.

use crate::ExportError;
use crate::layout::{FoldLine, Rect, Sheet, SheetLine, Size};
use pdfium_render::prelude::*;

/// How far past a line's end its tick starts.
const GAP: f64 = 2.0;
/// The longest a tick is drawn.
const LENGTH: f64 = 12.0;
/// How close to the sheet's edge a tick may get.
const EDGE_MARGIN: f64 = 2.0;
/// Shorter ticks are not worth drawing.
const MIN_LENGTH: f64 = 3.0;
const STROKE_WIDTH: f32 = 0.25;

/// Which way a markable line runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    Horizontal,
    Vertical,
}

/// The axis of `line` when it can be marked: horizontal with x1 < x2, or
/// vertical with y1 < y2. `None` for any other line, including a point.
pub fn line_axis(line: &SheetLine) -> Option<Axis> {
    if line.y1 == line.y2 && line.x1 < line.x2 {
        Some(Axis::Horizontal)
    } else if line.x1 == line.x2 && line.y1 < line.y2 {
        Some(Axis::Vertical)
    } else {
        None
    }
}

/// The ticks for the two ends of `line`, in layout coordinates: the start
/// end's first, then the far end's. Each runs outward along the line,
/// starting 2 pt past the end, up to 12 pt long. A clip that reaches past
/// the end (the piece's own bleed) is stepped over: the tick then starts
/// 2 pt past that clip. The tick stops at the first other clip it would
/// enter (it may touch a clip's edge) and 2 pt inside the sheet edge; a tick
/// under 3 pt is dropped. A line [`line_axis`] rejects gets no ticks.
pub fn mark_segments(line: &SheetLine, clips: &[Rect], sheet: &Size) -> Vec<SheetLine> {
    let Some(axis) = line_axis(line) else {
        return Vec::new();
    };
    let horizontal = axis == Axis::Horizontal;
    // Work along the line's axis as `a`, across it as `b`.
    let (a1, a2, b, a_size) = if horizontal {
        (line.x1, line.x2, line.y1, sheet.width)
    } else {
        (line.y1, line.y2, line.x1, sheet.height)
    };
    let half_stroke = f64::from(STROKE_WIDTH) / 2.0;
    // Each clip as its interval along `a` (open: a tick's butt end may touch
    // its edge) and across `b` (closed and widened by half the stroke: a
    // tick has width, so one within half a stroke of a clip touches it).
    let spans: Vec<(f64, f64)> = clips
        .iter()
        .filter_map(|clip| {
            let (along, across) = if horizontal {
                ((clip.x, clip.width), (clip.y, clip.height))
            } else {
                ((clip.y, clip.height), (clip.x, clip.width))
            };
            let touches = across.0 - half_stroke <= b && b <= across.0 + across.1 + half_stroke;
            touches.then_some((along.0, along.0 + along.1))
        })
        .collect();

    let tick = |end: f64, outward: f64| -> Option<(f64, f64)> {
        // A clip overhangs the line's end when the end lies inside it by more
        // than half a stroke; past those clips, the tick starts.
        let near = spans
            .iter()
            .filter(|(from, to)| from + half_stroke < end && end < to - half_stroke)
            .map(|&(from, to)| if outward > 0.0 { to } else { from })
            .fold(end, |near, edge| {
                if outward > 0.0 {
                    near.max(edge)
                } else {
                    near.min(edge)
                }
            })
            + outward * GAP;
        // Distance along the ray from `near` to the farthest allowed point.
        let mut room = LENGTH;
        let to_edge = if outward > 0.0 {
            a_size - EDGE_MARGIN - near
        } else {
            near - EDGE_MARGIN
        };
        room = room.min(to_edge);
        for along in &spans {
            let (from, to) = if outward > 0.0 {
                (along.0 - near, along.1 - near)
            } else {
                (near - along.1, near - along.0)
            };
            if to > 0.0 {
                room = room.min(from.max(0.0));
            }
        }
        (room >= MIN_LENGTH).then_some((near, near + outward * room))
    };

    [tick(a1, -1.0), tick(a2, 1.0)]
        .into_iter()
        .flatten()
        .map(|(from, to)| {
            let (lo, hi) = (from.min(to), from.max(to));
            if horizontal {
                SheetLine {
                    x1: lo,
                    y1: b,
                    x2: hi,
                    y2: b,
                }
            } else {
                SheetLine {
                    x1: b,
                    y1: lo,
                    x2: b,
                    y2: hi,
                }
            }
        })
        .collect()
}

/// How a tick is stroked: solid, or with alternating on and off lengths.
#[derive(Clone, Copy)]
enum Stroke {
    Solid,
    Dashed(&'static [f32]),
}

const SPINE_DASH: Stroke = Stroke::Dashed(&[3.0, 2.0]);
const OPENS_BY_TRIM_DOT: Stroke = Stroke::Dashed(&[0.5, 1.5]);

/// What [`draw_marks`] did with one sheet's requested lines.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MarksDrawn {
    /// Lines that could be marked.
    pub lines: usize,
    /// Lines skipped because [`line_axis`] rejects them.
    pub skipped: usize,
    pub ticks: usize,
}

/// Draws the requested marks of `sheet` on `page` (the sheet's front, sized
/// as `size`) and reports what it drew.
pub fn draw_marks<'a>(
    document: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    sheet: &Sheet,
    size: &Size,
    cut_marks: bool,
    fold_marks: bool,
) -> Result<MarksDrawn, ExportError> {
    let clips: Vec<Rect> = sheet.front.placements.iter().map(|p| p.clip).collect();
    let cuts = sheet.cut_lines.iter().map(|line| (*line, Stroke::Solid));
    let folds = sheet.fold_lines.iter().map(|fold| {
        let FoldLine {
            x1,
            y1,
            x2,
            y2,
            opens_by_trim,
        } = *fold;
        let stroke = if opens_by_trim {
            OPENS_BY_TRIM_DOT
        } else {
            SPINE_DASH
        };
        (SheetLine { x1, y1, x2, y2 }, stroke)
    });
    let lines = cut_marks
        .then_some(cuts)
        .into_iter()
        .flatten()
        .chain(fold_marks.then_some(folds).into_iter().flatten());

    let mut drawn = MarksDrawn::default();
    for (line, stroke) in lines {
        if line_axis(&line).is_none() {
            drawn.skipped += 1;
            continue;
        }
        drawn.lines += 1;
        for tick in mark_segments(&line, &clips, size) {
            // Layout y runs down from the top; PDF y runs up from the bottom.
            let mut path = PdfPagePathObject::new_line(
                document,
                PdfPoints::new(tick.x1 as f32),
                PdfPoints::new((size.height - tick.y1) as f32),
                PdfPoints::new(tick.x2 as f32),
                PdfPoints::new((size.height - tick.y2) as f32),
                PdfColor::BLACK,
                PdfPoints::new(STROKE_WIDTH),
            )?;
            if let Stroke::Dashed(pattern) = stroke {
                let pattern: Vec<PdfPoints> =
                    pattern.iter().map(|&len| PdfPoints::new(len)).collect();
                path.set_dash_array(&pattern, PdfPoints::ZERO)?;
            }
            page.objects_mut().add_path_object(path)?;
            drawn.ticks += 1;
        }
    }
    Ok(drawn)
}
