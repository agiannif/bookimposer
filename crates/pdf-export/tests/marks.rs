//! Cut and fold marks: the exporter draws each side's `marks` from the
//! Layout, on the front and on the back, and only in the margins.

mod support;

use pdf_export::geometry::to_pdf_rect;
use pdf_export::layout::{self, Layout, SheetLine};
use pdf_export::{ExportOptions, export};
use std::sync::OnceLock;
use support::{FixturePage, assert_images_match, crop_region, fixture_pdf, pdfium, render};

const PX_PER_PT: f32 = 4.0;
const BOTH: ExportOptions = ExportOptions {
    cut_marks: true,
    fold_marks: true,
};

/// One signature folded twice, two pieces side by side with an 18 pt gap
/// and a 9 pt bleed, so every clip reaches 9 pt past its cut and fold lines.
fn bleed_sheet() -> Layout {
    layout::parse(include_str!("data/bleed-sheet.layout.json")).unwrap()
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
fn sheet_with_no_room_for_marks_draws_none() {
    let layout = layout::parse(include_str!("data/full-bleed-sheet.layout.json")).unwrap();
    let marked = export(pdfium(), &no_margin_source(), &layout, &BOTH).unwrap();
    // The engine reports the missing marks as a Layout issue; the exporter adds no warning of its own.
    assert_eq!(marked.warnings, Vec::<String>::new());
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
    layout.sheets[0].front.marks.fold[1].opens_by_trim = true;
    let out = export(pdfium(), source(), &layout, &BOTH).unwrap();
    let doc = lopdf::Document::load_mem(&out.pdf).unwrap();
    let page = doc.get_pages()[&1];
    let content = String::from_utf8(support::merged_page_content(&doc, page)).unwrap();
    assert!(content.contains("[3 2] 0 d"), "{content}");
    assert!(content.contains("[.5 1.5] 0 d"), "{content}");
}

/// Whether any pixel along `tick`, a point short of each end and within a
/// pixel across it, is dark. Scanning the length finds dashed and dotted
/// ticks wherever their pattern starts.
fn tick_is_dark(image: &image::RgbImage, tick: &SheetLine) -> bool {
    let px = |pt: f64| (pt * f64::from(PX_PER_PT)).round() as u32;
    let horizontal = tick.y1 == tick.y2;
    let (lo, hi, across) = if horizontal {
        (tick.x1, tick.x2, tick.y1)
    } else {
        (tick.y1, tick.y2, tick.x1)
    };
    let across = px(across);
    (px(lo + 1.0)..=px(hi - 1.0)).any(|along| {
        (across - 1..=across + 1).any(|across| {
            let (x, y) = if horizontal {
                (along, across)
            } else {
                (across, along)
            };
            image.get_pixel(x, y).0[0] < 200
        })
    })
}

#[test]
fn back_marks_show_where_the_layout_puts_them() {
    let mut layout = bleed_sheet();
    let source = bleed_source();
    // Leave out the back's first cut tick, so a back that drew the front's marks would show it.
    let left_out = layout.sheets[0].back.marks.cut.remove(0);
    let marked = export(pdfium(), &source, &layout, &BOTH).unwrap();
    let plain = export(pdfium(), &source, &layout, &ExportOptions::default()).unwrap();
    let back = render(pdfium(), &marked.pdf, 1, PX_PER_PT);
    let plain_back = render(pdfium(), &plain.pdf, 1, PX_PER_PT);

    let marks = &layout.sheets[0].back.marks;
    let folds = marks.fold.iter().map(|f| SheetLine {
        x1: f.x1,
        y1: f.y1,
        x2: f.x2,
        y2: f.y2,
    });
    for tick in marks.cut.iter().copied().chain(folds) {
        assert!(tick_is_dark(&back, &tick), "no back tick at {tick:?}");
        assert!(
            !tick_is_dark(&plain_back, &tick),
            "{tick:?} is dark unmarked"
        );
    }
    assert!(!tick_is_dark(&back, &left_out), "{left_out:?} drawn");

    for placement in &layout.sheets[0].back.placements {
        let region = to_pdf_rect(&placement.clip, &layout.sheet);
        assert_images_match(
            &crop_region(&back, 850.0, &region, PX_PER_PT),
            &crop_region(&plain_back, 850.0, &region, PX_PER_PT),
            "back clip region",
        );
    }
}

#[test]
fn back_marks_follow_the_options() {
    let layout = bleed_sheet();
    let source = bleed_source();
    let cut_only = ExportOptions {
        cut_marks: true,
        fold_marks: false,
    };
    let out = export(pdfium(), &source, &layout, &cut_only).unwrap();
    let back = render(pdfium(), &out.pdf, 1, PX_PER_PT);
    let marks = &layout.sheets[0].back.marks;
    assert!(tick_is_dark(&back, &marks.cut[0]));
    let fold = marks.fold[0];
    let fold = SheetLine {
        x1: fold.x1,
        y1: fold.y1,
        x2: fold.x2,
        y2: fold.y2,
    };
    assert!(!tick_is_dark(&back, &fold), "fold tick {fold:?} drawn");
}

#[test]
fn marks_are_drawn_in_the_layouts_style() {
    // A hand-edited style, unlike the engine's, so only reading it from the Layout draws it.
    let mut json: serde_json::Value =
        serde_json::from_str(include_str!("data/worked-example.layout.json")).unwrap();
    json["markStyle"] = serde_json::json!({
        "strokeWidth": 2,
        "dash": {"spine": [7, 1], "opensByTrim": [4, 4.5]},
    });
    json["sheets"][0]["front"]["marks"]["fold"][1]["opensByTrim"] = true.into();
    let layout = layout::parse(&json.to_string()).unwrap();
    let out = export(pdfium(), source(), &layout, &BOTH).unwrap();
    let doc = lopdf::Document::load_mem(&out.pdf).unwrap();
    let page = doc.get_pages()[&1];
    let content = String::from_utf8(support::merged_page_content(&doc, page)).unwrap();
    assert!(content.contains("[7 1] 0 d"), "{content}");
    assert!(content.contains("[4 4.5] 0 d"), "{content}");
    assert!(content.contains("2 w"), "{content}");
    assert!(!content.contains(".25 w"), "{content}");
}
