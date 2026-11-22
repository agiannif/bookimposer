//! Cut and fold marks sit in the margins, outside every placement's clip.

mod support;

use pdf_export::geometry::to_pdf_rect;
use pdf_export::layout::{self, Layout, Rect, SheetLine, Size};
use pdf_export::marks::mark_segments;
use pdf_export::{ExportOptions, export};
use std::sync::OnceLock;
use support::{FixturePage, assert_images_match, crop_region, fixture_pdf, pdfium, render};

const PX_PER_PT: f32 = 4.0;
const SHEET: Size = Size {
    width: 612.0,
    height: 792.0,
};
const BOTH: ExportOptions = ExportOptions {
    cut_marks: true,
    fold_marks: true,
};

fn clip(x: f64, y: f64) -> Rect {
    Rect {
        x,
        y,
        width: 288.0,
        height: 378.0,
    }
}

/// Sheet 0 of the worked example: four pieces on a letter sheet, 18 pt margin.
fn clips() -> Vec<Rect> {
    vec![
        clip(18.0, 18.0),
        clip(306.0, 18.0),
        clip(18.0, 396.0),
        clip(306.0, 396.0),
    ]
}

fn line(x1: f64, y1: f64, x2: f64, y2: f64) -> SheetLine {
    SheetLine { x1, y1, x2, y2 }
}

#[test]
fn cut_line_gets_a_tick_past_each_end() {
    assert_eq!(
        mark_segments(&line(18.0, 18.0, 594.0, 18.0), &clips(), &SHEET),
        vec![line(4.0, 18.0, 16.0, 18.0), line(596.0, 18.0, 608.0, 18.0)]
    );
}

#[test]
fn fold_end_blocked_by_the_next_piece_gets_no_tick() {
    assert_eq!(
        mark_segments(&line(306.0, 18.0, 306.0, 396.0), &clips(), &SHEET),
        vec![line(306.0, 4.0, 306.0, 16.0)]
    );
}

#[test]
fn fold_at_the_bottom_ticks_below_the_last_piece() {
    assert_eq!(
        mark_segments(&line(306.0, 396.0, 306.0, 774.0), &clips(), &SHEET),
        vec![line(306.0, 776.0, 306.0, 788.0)]
    );
}

#[test]
fn tick_stops_2_pt_inside_the_sheet_edge() {
    // The right end has room for 10 pt after the 2 pt gap, up to 2 pt from the edge.
    let sheet = Size {
        width: 214.0,
        height: 20.0,
    };
    assert_eq!(
        mark_segments(&line(100.0, 10.0, 200.0, 10.0), &[], &sheet),
        vec![line(86.0, 10.0, 98.0, 10.0), line(202.0, 10.0, 212.0, 10.0)]
    );
}

#[test]
fn ticks_shorter_than_3_pt_are_dropped() {
    // 2 pt of room before the left end's gap runs out, none at the right.
    let sheet = Size {
        width: 104.0,
        height: 20.0,
    };
    assert_eq!(
        mark_segments(&line(6.0, 10.0, 100.0, 10.0), &[], &sheet),
        Vec::<SheetLine>::new()
    );
}

#[test]
fn tick_is_cut_short_where_it_would_enter_a_clip() {
    let clip = Rect {
        x: 110.0,
        y: 0.0,
        width: 5.0,
        height: 20.0,
    };
    // The right tick would run 102 to 114; the clip starts at 110, which cuts the tick to 8 pt.
    let ticks = mark_segments(&line(50.0, 10.0, 100.0, 10.0), &[clip], &SHEET);
    assert_eq!(
        ticks,
        vec![line(36.0, 10.0, 48.0, 10.0), line(102.0, 10.0, 110.0, 10.0)]
    );
}

#[test]
fn tick_within_half_a_stroke_of_a_clip_counts_as_touching_it() {
    // The clip ends 0.1 pt above the line, closer than half the 0.25 pt
    // stroke, so the right tick stops where the clip starts.
    let clip = Rect {
        x: 110.0,
        y: 0.0,
        width: 5.0,
        height: 9.9,
    };
    let ticks = mark_segments(&line(50.0, 10.0, 100.0, 10.0), &[clip], &SHEET);
    assert_eq!(
        ticks,
        vec![line(36.0, 10.0, 48.0, 10.0), line(102.0, 10.0, 110.0, 10.0)]
    );
}

#[test]
fn lines_that_are_not_horizontal_or_vertical_get_no_ticks() {
    for bad in [
        line(50.0, 10.0, 100.0, 20.0),
        line(100.0, 10.0, 50.0, 10.0),
        line(10.0, 100.0, 10.0, 50.0),
        line(50.0, 10.0, 50.0, 10.0),
    ] {
        assert_eq!(
            mark_segments(&bad, &[], &SHEET),
            Vec::<SheetLine>::new(),
            "{bad:?}"
        );
    }
}

/// One signature folded twice, two pieces side by side with an 18 pt gap
/// and a 9 pt bleed, so every clip reaches 9 pt past its cut and fold lines.
fn bleed_sheet() -> Layout {
    layout::parse(include_str!("data/bleed-sheet.layout.json")).unwrap()
}

#[test]
fn bleed_tick_starts_past_the_pieces_own_bleed() {
    let layout = bleed_sheet();
    let clips: Vec<Rect> = layout.sheets[0]
        .front
        .placements
        .iter()
        .map(|p| p.clip)
        .collect();
    // The top cut of the left piece; its clips reach x 47 to 641.
    assert_eq!(
        mark_segments(&line(56.0, 47.0, 632.0, 47.0), &clips, &layout.sheet),
        vec![line(33.0, 47.0, 45.0, 47.0), line(643.0, 47.0, 655.0, 47.0)]
    );
}

#[test]
fn every_line_of_a_bleed_sheet_gets_ticks_outside_every_clip() {
    let layout = bleed_sheet();
    let sheet = &layout.sheets[0];
    let clips: Vec<Rect> = sheet.front.placements.iter().map(|p| p.clip).collect();
    let folds = sheet
        .fold_lines
        .iter()
        .map(|f| line(f.x1, f.y1, f.x2, f.y2));
    let half_stroke = 0.125;
    for marked in sheet.cut_lines.iter().copied().chain(folds) {
        let ticks = mark_segments(&marked, &clips, &layout.sheet);
        assert_eq!(ticks.len(), 2, "{marked:?}: {ticks:?}");
        for tick in ticks {
            // The tick's stroke, as a rectangle.
            let (left, right) = (tick.x1 - half_stroke, tick.x2 + half_stroke);
            let (top, bottom) = (tick.y1 - half_stroke, tick.y2 + half_stroke);
            let (left, right, top, bottom) = if tick.y1 == tick.y2 {
                (tick.x1, tick.x2, top, bottom)
            } else {
                (left, right, tick.y1, tick.y2)
            };
            for clip in &clips {
                let overlaps = left < clip.x + clip.width
                    && right > clip.x
                    && top < clip.y + clip.height
                    && bottom > clip.y;
                assert!(
                    !overlaps,
                    "{marked:?}: tick {tick:?} overlaps clip {clip:?}"
                );
            }
        }
    }
}

fn source() -> &'static [u8] {
    static SOURCE: OnceLock<Vec<u8>> = OnceLock::new();
    SOURCE.get_or_init(|| {
        let pages: Vec<FixturePage> = (1..=76)
            .map(|label| FixturePage {
                media: (0.0, 0.0, 288.0, 378.0),
                trim: None,
                bleed: None,
                label,
            })
            .collect();
        fixture_pdf(pdfium(), &pages)
    })
}

fn worked_example() -> Layout {
    layout::parse(include_str!("data/worked-example.layout.json")).unwrap()
}

#[test]
fn marks_stay_out_of_every_clip_and_show_in_the_margins() {
    let layout = worked_example();
    let plain = export(pdfium(), source(), &layout, &ExportOptions::default()).unwrap();
    let marked = export(pdfium(), source(), &layout, &BOTH).unwrap();
    assert_eq!(marked.warnings, Vec::<String>::new());
    let plain = render(pdfium(), &plain.pdf, 0, PX_PER_PT);
    let marked = render(pdfium(), &marked.pdf, 0, PX_PER_PT);

    // Inside each clip the page is exactly as it is without marks.
    for placement in &layout.sheets[0].front.placements {
        let region = to_pdf_rect(&placement.clip, &layout.sheet);
        assert_images_match(
            &crop_region(&marked, 792.0, &region, PX_PER_PT),
            &crop_region(&plain, 792.0, &region, PX_PER_PT),
            "clip region",
        );
    }

    // The top-left cut tick runs (4,18)-(16,18); its centre is dark.
    let (x, y) = (40, 72);
    assert_eq!(plain.get_pixel(x, y).0, [255, 255, 255]);
    let darkest = (y - 1..=y)
        .map(|y| marked.get_pixel(x, y).0[0])
        .min()
        .unwrap();
    assert!(darkest < 200, "no cut tick at ({x}, {y}): {darkest}");
}

#[test]
fn no_marks_unless_asked() {
    let layout = worked_example();
    let cut_only = ExportOptions {
        cut_marks: true,
        fold_marks: false,
    };
    let fold_only = ExportOptions {
        cut_marks: false,
        fold_marks: true,
    };
    let image = |options: &ExportOptions| {
        let out = export(pdfium(), source(), &layout, options).unwrap();
        render(pdfium(), &out.pdf, 0, PX_PER_PT)
    };
    let (cut, fold) = (image(&cut_only), image(&fold_only));
    // Fold tick above the spine at x=306, y 4..16; cut tick at x 4..16, y=18.
    let dark = |img: &image::RgbImage, x: u32, y: u32| {
        (x - 1..=x + 1).any(|x| (y - 1..=y + 1).any(|y| img.get_pixel(x, y).0[0] < 200))
    };
    assert!(dark(&cut, 40, 72) && !dark(&cut, 1224, 40));
    assert!(dark(&fold, 1224, 40) && !dark(&fold, 40, 72));
}

#[test]
fn sheet_with_no_room_for_marks_warns() {
    let layout = layout::parse(include_str!("data/full-bleed-sheet.layout.json")).unwrap();
    let marked = export(pdfium(), &no_margin_source(), &layout, &BOTH).unwrap();
    assert_eq!(
        marked.warnings,
        vec!["cut/fold marks would overlap page content on sheet 1"]
    );
    let plain = export(
        pdfium(),
        &no_margin_source(),
        &layout,
        &ExportOptions::default(),
    )
    .unwrap();
    assert_images_match(
        &render(pdfium(), &marked.pdf, 0, 1.0),
        &render(pdfium(), &plain.pdf, 0, 1.0),
        "front without marks",
    );
}

#[test]
fn bleed_sheet_marks_show_outside_every_clip() {
    let layout = bleed_sheet();
    let source = bleed_source();
    let plain = export(pdfium(), &source, &layout, &ExportOptions::default()).unwrap();
    let marked = export(pdfium(), &source, &layout, &BOTH).unwrap();
    assert_eq!(marked.warnings, Vec::<String>::new());
    let plain = render(pdfium(), &plain.pdf, 0, PX_PER_PT);
    let marked = render(pdfium(), &marked.pdf, 0, PX_PER_PT);

    for placement in &layout.sheets[0].front.placements {
        let region = to_pdf_rect(&placement.clip, &layout.sheet);
        assert_images_match(
            &crop_region(&marked, 850.0, &region, PX_PER_PT),
            &crop_region(&plain, 850.0, &region, PX_PER_PT),
            "clip region",
        );
    }

    // The left piece's top cut tick runs (33,47)-(45,47); its centre is dark.
    let (x, y) = (156, 188);
    assert_eq!(plain.get_pixel(x, y).0, [255, 255, 255]);
    let darkest = (y - 1..=y)
        .map(|y| marked.get_pixel(x, y).0[0])
        .min()
        .unwrap();
    assert!(darkest < 200, "no cut tick at ({x}, {y}): {darkest}");
}

/// 16 pages of 288x378 trim with a 9 pt bleed all round.
fn bleed_source() -> Vec<u8> {
    let pages: Vec<FixturePage> = (1..=16)
        .map(|label| FixturePage {
            media: (0.0, 0.0, 306.0, 396.0),
            trim: Some((9.0, 9.0, 297.0, 387.0)),
            bleed: Some((0.0, 0.0, 306.0, 396.0)),
            label,
        })
        .collect();
    fixture_pdf(pdfium(), &pages)
}

#[test]
fn line_that_is_not_horizontal_or_vertical_is_skipped_with_a_warning() {
    let mut layout = worked_example();
    layout.sheets[0].cut_lines[0] = line(18.0, 18.0, 594.0, 30.0);
    let marked = export(pdfium(), source(), &layout, &BOTH).unwrap();
    assert_eq!(
        marked.warnings,
        vec!["skipped 1 cut/fold line(s) on sheet 1 that are not horizontal or vertical"]
    );
}

fn no_margin_source() -> Vec<u8> {
    let pages: Vec<FixturePage> = (1..=8)
        .map(|label| FixturePage {
            media: (0.0, 0.0, 288.0, 378.0),
            trim: None,
            bleed: None,
            label,
        })
        .collect();
    fixture_pdf(pdfium(), &pages)
}

#[test]
fn fold_marks_are_dashed_and_trim_folds_dotted() {
    let mut layout = worked_example();
    layout.sheets[0].fold_lines[1].opens_by_trim = true;
    let out = export(pdfium(), source(), &layout, &BOTH).unwrap();
    let doc = lopdf::Document::load_mem(&out.pdf).unwrap();
    let page = doc.get_pages()[&1];
    let content = String::from_utf8(support::merged_page_content(&doc, page)).unwrap();
    assert!(content.contains("[3 2] 0 d"), "{content}");
    assert!(content.contains("[.5 1.5] 0 d"), "{content}");
}
