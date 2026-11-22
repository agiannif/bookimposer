//! Conversions from layout coordinates (top-left origin, y down) to PDF
//! coordinates (bottom-left origin, y up), and the transform that fits a
//! source page into its content box.

use crate::layout::{Rect, Size};
use pdfium_render::prelude::PdfRect;
use serde::Serialize;

/// A rectangle in PDF points, origin bottom-left, y up.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PdfBox {
    pub left: f32,
    pub bottom: f32,
    pub width: f32,
    pub height: f32,
}

impl From<PdfRect> for PdfBox {
    fn from(rect: PdfRect) -> Self {
        PdfBox {
            left: rect.left().value,
            bottom: rect.bottom().value,
            width: rect.width().value,
            height: rect.height().value,
        }
    }
}

/// The layout rectangle `r` on a sheet of size `sheet`, in PDF coordinates.
pub fn to_pdf_rect(r: &Rect, sheet: &Size) -> PdfBox {
    PdfBox {
        left: r.x as f32,
        bottom: (sheet.height - r.y - r.height) as f32,
        width: r.width as f32,
        height: r.height as f32,
    }
}

/// Where `trim`, in a page's own coordinates, lies once that page is turned
/// `rotation` degrees clockwise (its /Rotate) and moved so the lower-left
/// corner of its displayed `page_box` (CropBox within MediaBox) is the origin.
/// That is the coordinate space of PDFium's page-to-form-XObject copy, whose
/// /Matrix does exactly this.
///
/// # Panics
///
/// If `rotation` is not 0, 90, 180 or 270; PDFium reports no others.
pub fn displayed_box(trim: &PdfBox, page_box: &PdfBox, rotation: u16) -> PdfBox {
    // Distances from the trim's edges to the page box's matching edges.
    let left = trim.left - page_box.left;
    let bottom = trim.bottom - page_box.bottom;
    let right = page_box.left + page_box.width - (trim.left + trim.width);
    let top = page_box.bottom + page_box.height - (trim.bottom + trim.height);
    // Turning clockwise, the side that was at the bottom shows on the left,
    // and so on round.
    let (left, bottom, turned) = match rotation {
        0 => (left, bottom, false),
        90 => (bottom, right, true),
        180 => (right, top, false),
        270 => (top, left, true),
        _ => panic!("rotation must be 0, 90, 180 or 270, got {rotation}"),
    };
    let (width, height) = if turned {
        (trim.height, trim.width)
    } else {
        (trim.width, trim.height)
    };
    PdfBox {
        left,
        bottom,
        width,
        height,
    }
}

/// The PDF matrix `(a b c d e f)` that maps source page coordinates so the
/// source `trim` box fills `content`, turned `rotation` degrees clockwise as
/// seen. The scale is uniform; `content` is expected to have the trim box's
/// aspect ratio (swapped when turned 90 or 270 degrees).
///
/// # Panics
///
/// If `rotation` is not 0, 90, 180 or 270; the layout parser rejects others.
pub fn placement_matrix(trim: &PdfBox, content: &PdfBox, rotation: u16) -> [f32; 6] {
    let (left, bottom) = (content.left, content.bottom);
    let (right, top) = (left + content.width, bottom + content.height);
    // With u = x - trim.left, v = y - trim.bottom and s the uniform scale,
    // each case's x' and y' (in the comments) expand into the matrix terms
    // x' = a x + c y + e and y' = b x + d y + f.
    match rotation {
        0 => {
            // x' = left + s u, y' = bottom + s v
            let s = content.width / trim.width;
            [
                s,
                0.0,
                0.0,
                s,
                left - s * trim.left,
                bottom - s * trim.bottom,
            ]
        }
        90 => {
            // x' = left + s v, y' = top - s u
            let s = content.width / trim.height;
            [0.0, -s, s, 0.0, left - s * trim.bottom, top + s * trim.left]
        }
        180 => {
            // x' = right - s u, y' = top - s v
            let s = content.width / trim.width;
            [
                -s,
                0.0,
                0.0,
                -s,
                right + s * trim.left,
                top + s * trim.bottom,
            ]
        }
        270 => {
            // x' = right - s v, y' = bottom + s u
            let s = content.width / trim.height;
            [
                0.0,
                s,
                -s,
                0.0,
                right + s * trim.bottom,
                bottom - s * trim.left,
            ]
        }
        _ => panic!("rotation must be 0, 90, 180 or 270, got {rotation}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TRIM: PdfBox = PdfBox {
        left: 0.0,
        bottom: 0.0,
        width: 288.0,
        height: 378.0,
    };
    const UPRIGHT: PdfBox = PdfBox {
        left: 18.0,
        bottom: 396.0,
        width: 288.0,
        height: 378.0,
    };
    const SIDEWAYS: PdfBox = PdfBox {
        left: 18.0,
        bottom: 396.0,
        width: 378.0,
        height: 288.0,
    };

    /// The /Matrix PDFium gives the form XObject it copies from a page whose
    /// page box is (10, 20)-(298, 398), per /Rotate; read from its output.
    const PDFIUM_FORM_MATRICES: [(u16, [f32; 6]); 4] = [
        (0, [1.0, 0.0, 0.0, 1.0, -10.0, -20.0]),
        (90, [0.0, -1.0, 1.0, 0.0, -20.0, 298.0]),
        (180, [-1.0, 0.0, 0.0, -1.0, 298.0, 398.0]),
        (270, [0.0, 1.0, -1.0, 0.0, 398.0, -10.0]),
    ];

    #[test]
    fn displayed_box_matches_pdfiums_form_matrix() {
        let page_box = PdfBox {
            left: 10.0,
            bottom: 20.0,
            width: 288.0,
            height: 378.0,
        };
        let trim = PdfBox {
            left: 19.0,
            bottom: 24.0,
            width: 200.0,
            height: 300.0,
        };
        for (rotation, matrix) in PDFIUM_FORM_MATRICES {
            let corners = [
                (trim.left, trim.bottom),
                (trim.left + trim.width, trim.bottom + trim.height),
            ]
            .map(|corner| apply(matrix, corner));
            let expected = PdfBox {
                left: corners[0].0.min(corners[1].0),
                bottom: corners[0].1.min(corners[1].1),
                width: (corners[0].0 - corners[1].0).abs(),
                height: (corners[0].1 - corners[1].1).abs(),
            };
            assert_eq!(
                displayed_box(&trim, &page_box, rotation),
                expected,
                "rotation {rotation}"
            );
        }
    }

    fn apply(m: [f32; 6], (x, y): (f32, f32)) -> (f32, f32) {
        let [a, b, c, d, e, f] = m;
        (a * x + c * y + e, b * x + d * y + f)
    }

    /// Where the source page's top-left corner lands.
    fn top_left_lands(content: &PdfBox, rotation: u16) -> (f32, f32) {
        apply(placement_matrix(&TRIM, content, rotation), (0.0, 378.0))
    }

    #[test]
    fn upright_keeps_top_left_at_top_left() {
        assert_eq!(top_left_lands(&UPRIGHT, 0), (18.0, 774.0));
    }

    #[test]
    fn quarter_turn_moves_top_left_to_top_right() {
        assert_eq!(top_left_lands(&SIDEWAYS, 90), (396.0, 684.0));
    }

    #[test]
    fn half_turn_moves_top_left_to_bottom_right() {
        assert_eq!(top_left_lands(&UPRIGHT, 180), (306.0, 396.0));
    }

    #[test]
    fn three_quarter_turn_moves_top_left_to_bottom_left() {
        assert_eq!(top_left_lands(&SIDEWAYS, 270), (18.0, 396.0));
    }

    #[test]
    fn trim_fills_content_box_at_every_rotation() {
        for (content, rotation) in [
            (UPRIGHT, 0),
            (SIDEWAYS, 90),
            (UPRIGHT, 180),
            (SIDEWAYS, 270),
        ] {
            let m = placement_matrix(&TRIM, &content, rotation);
            let corners = [(0.0, 0.0), (288.0, 0.0), (0.0, 378.0), (288.0, 378.0)]
                .map(|corner| apply(m, corner));
            let xs = corners.map(|(x, _)| x);
            let ys = corners.map(|(_, y)| y);
            let min = |v: [f32; 4]| v.into_iter().fold(f32::INFINITY, f32::min);
            let max = |v: [f32; 4]| v.into_iter().fold(f32::NEG_INFINITY, f32::max);
            assert_eq!(
                (min(xs), min(ys), max(xs), max(ys)),
                (
                    content.left,
                    content.bottom,
                    content.left + content.width,
                    content.bottom + content.height
                ),
                "rotation {rotation}"
            );
        }
    }

    #[test]
    fn offset_trim_and_scale_are_applied() {
        let trim = PdfBox {
            left: 9.0,
            bottom: 9.0,
            width: 288.0,
            height: 378.0,
        };
        let half = PdfBox {
            left: 18.0,
            bottom: 396.0,
            width: 144.0,
            height: 189.0,
        };
        let m = placement_matrix(&trim, &half, 0);
        assert_eq!(apply(m, (9.0, 9.0)), (18.0, 396.0));
        assert_eq!(apply(m, (297.0, 387.0)), (162.0, 585.0));
    }

    #[test]
    fn layout_rect_flips_to_pdf_coordinates() {
        let rect = Rect {
            x: 18.0,
            y: 18.0,
            width: 288.0,
            height: 378.0,
        };
        let sheet = Size {
            width: 612.0,
            height: 792.0,
        };
        assert_eq!(
            to_pdf_rect(&rect, &sheet),
            PdfBox {
                left: 18.0,
                bottom: 396.0,
                width: 288.0,
                height: 378.0,
            }
        );
    }
}
