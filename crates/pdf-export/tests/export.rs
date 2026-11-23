//! `export` writes every sheet of a Layout as a front and a back page, with
//! each source page embedded unchanged.

mod support;

use lopdf::{Document, Object};
use pdf_export::geometry::to_pdf_rect;
use pdf_export::layout::{self, Issue, Layout, PagePlacement, Sheet, SheetSide, SideMarks};
use pdf_export::{ExportError, ExportOptions, export, page_sizes};
use pdfium_render::prelude::*;
use std::collections::HashSet;
use std::sync::OnceLock;
use support::{
    FixturePage, assert_images_match, book_pdf, crop_region, decoded, fixture_pdf,
    merged_page_content, pdfium, render, turned, with_crop, with_rotation, with_square_annotation,
    with_text_field,
};

const PX_PER_PT: f32 = 4.0;
const WHITE: [u8; 3] = [255, 255, 255];
const PAGE_COUNT: usize = 76;

/// The 76-page book fixture.
fn source() -> &'static [u8] {
    static SOURCE: OnceLock<Vec<u8>> = OnceLock::new();
    SOURCE.get_or_init(|| book_pdf(pdfium()))
}

/// The engine's imposition of the 76-page book: 9 signatures plus front and
/// back boards on letter sheets with an 18 pt margin, 10 sheets.
fn worked_example() -> Layout {
    layout::parse(include_str!("data/worked-example.layout.json")).unwrap()
}

/// The worked example exported from [`source`], computed once.
fn exported() -> &'static [u8] {
    static EXPORTED: OnceLock<Vec<u8>> = OnceLock::new();
    EXPORTED.get_or_init(|| export_pdf(source(), &worked_example()))
}

fn export_pdf(source: &[u8], layout: &Layout) -> Vec<u8> {
    let output = export(pdfium(), source, layout, &ExportOptions::default()).unwrap();
    assert_eq!(output.warnings, Vec::<String>::new());
    output.pdf
}

#[test]
fn writes_a_front_and_a_back_page_per_sheet() {
    let document = pdfium().load_pdf_from_byte_slice(exported(), None).unwrap();
    let sizes: Vec<(f32, f32)> = document
        .pages()
        .iter()
        .map(|page| (page.width().value, page.height().value))
        .collect();
    assert_eq!(sizes, vec![(612.0, 792.0); 22]);
}

#[test]
fn byte_identity() {
    let source_doc = Document::load_mem(source()).unwrap();
    let output_doc = Document::load_mem(exported()).unwrap();

    let forms: HashSet<Vec<u8>> = streams_of_subtype(&output_doc, b"Form")
        .map(decoded)
        .collect();
    for (number, page) in source_doc.get_pages() {
        assert!(
            forms.contains(&merged_page_content(&source_doc, page)),
            "no form XObject holds source page {number}'s content unchanged"
        );
    }

    let source_images: Vec<&[u8]> = streams_of_subtype(&source_doc, b"Image")
        .map(|stream| stream.content.as_slice())
        .collect();
    let output_images: Vec<&[u8]> = streams_of_subtype(&output_doc, b"Image")
        .map(|stream| stream.content.as_slice())
        .collect();
    assert_eq!(output_images.len(), source_images.len(), "image count");
    for image in &output_images {
        assert!(
            source_images.contains(image),
            "an output image stream differs from every source image"
        );
    }
}

#[test]
fn output_is_not_bloated() {
    let (source, output) = (source().len(), exported().len());
    assert!(
        output <= 2 * source + 64 * 1024,
        "output is {output} bytes, source {source} bytes"
    );
}

#[test]
fn visual_identity() {
    let layout = worked_example();
    let sides = [
        (2, &layout.sheets[1].front),
        (3, &layout.sheets[1].back),
        (20, &layout.sheets[10].front),
    ];
    for (output_page, side) in sides {
        let rendered = render(pdfium(), exported(), output_page, PX_PER_PT);
        for placement in &side.placements {
            let pdf_page = placement.pdf_page.unwrap();
            let alone = render(pdfium(), source(), pdf_page as u16, PX_PER_PT);
            assert_images_match(
                &crop_region(
                    &rendered,
                    layout.sheet.height as f32,
                    &to_pdf_rect(&placement.content, &layout.sheet),
                    PX_PER_PT,
                ),
                &turned(&alone, placement.rotation),
                &format!("output page {output_page}, source page {pdf_page}"),
            );
        }
    }
}

#[test]
fn hidden_board_back_is_blank() {
    let image = render(pdfium(), exported(), 21, PX_PER_PT);
    assert!(image.pixels().all(|pixel| pixel.0 == WHITE));
}

#[test]
fn blank_panel_stays_white() {
    let mut layout = worked_example();
    let blank = &mut layout.sheets[0].front.placements[0];
    blank.pdf_page = None;
    let region = to_pdf_rect(&blank.clip, &layout.sheet);

    let pdf = export_pdf(source(), &layout);

    let image = render(pdfium(), &pdf, 0, PX_PER_PT);
    let panel = crop_region(&image, layout.sheet.height as f32, &region, PX_PER_PT);
    let (width, height) = panel.dimensions();
    // Skip a one-pixel border, where the neighbouring panels' edges may
    // anti-alias into this one.
    let painted = panel
        .enumerate_pixels()
        .filter(|&(x, y, _)| x > 0 && y > 0 && x < width - 1 && y < height - 1)
        .filter(|(_, _, pixel)| pixel.0 != WHITE)
        .count();
    assert_eq!(painted, 0, "painted pixels in the blank panel");
}

#[test]
fn rotate_attribute() {
    let pdfium = pdfium();
    let upright = fixture_pdf(
        pdfium,
        &[FixturePage {
            media: (0.0, 0.0, 288.0, 378.0),
            trim: None,
            bleed: None,
            label: 1,
        }],
    );
    let source = with_rotation(pdfium, &upright, 0, PdfPageRenderRotation::Degrees90);
    // The page displays 378 wide by 288 tall.
    let alone = render(pdfium, &source, 0, PX_PER_PT);
    assert_eq!(alone.dimensions(), (378 * 4, 288 * 4));

    let landscape = layout::Rect {
        x: 18.0,
        y: 18.0,
        width: 378.0,
        height: 288.0,
    };
    let portrait = layout::Rect {
        x: 18.0,
        y: 396.0,
        width: 288.0,
        height: 378.0,
    };
    let mut layout = worked_example();
    layout.sheets = vec![Sheet {
        front: SheetSide {
            placements: vec![placement(landscape, 0), placement(portrait, 90)],
            guides: SideMarks::default(),
            marks: SideMarks::default(),
        },
        back: SheetSide {
            placements: vec![],
            guides: SideMarks::default(),
            marks: SideMarks::default(),
        },
    }];

    let pdf = export_pdf(&source, &layout);

    let rendered = render(pdfium, &pdf, 0, PX_PER_PT);
    for (content, rotation) in [(landscape, 0), (portrait, 90)] {
        assert_images_match(
            &crop_region(
                &rendered,
                layout.sheet.height as f32,
                &to_pdf_rect(&content, &layout.sheet),
                PX_PER_PT,
            ),
            &turned(&alone, rotation),
            &format!("placement rotation {rotation}"),
        );
    }
}

/// A landscape page turned upright by /Rotate 90 reports its displayed,
/// portrait size, and a panel of exactly that size shows it at scale 1.
#[test]
fn rotated_page_fills_a_panel_of_its_reported_size() {
    let pdfium = pdfium();
    let landscape = fixture_pdf(
        pdfium,
        &[FixturePage {
            media: (0.0, 0.0, 378.0, 288.0),
            trim: None,
            bleed: None,
            label: 1,
        }],
    );
    let source = with_rotation(pdfium, &landscape, 0, PdfPageRenderRotation::Degrees90);

    let size = page_sizes(pdfium, &source).unwrap()[0].displayed_trim_size();
    assert_eq!(size, (288.0, 378.0));

    let panel = layout::Rect {
        x: 18.0,
        y: 18.0,
        width: f64::from(size.0),
        height: f64::from(size.1),
    };
    let mut layout = worked_example();
    layout.sheets = vec![Sheet {
        front: SheetSide {
            placements: vec![placement(panel, 0)],
            guides: SideMarks::default(),
            marks: SideMarks::default(),
        },
        back: SheetSide {
            placements: vec![],
            guides: SideMarks::default(),
            marks: SideMarks::default(),
        },
    }];

    let pdf = export_pdf(&source, &layout);

    let rendered = render(pdfium, &pdf, 0, PX_PER_PT);
    assert_images_match(
        &crop_region(
            &rendered,
            layout.sheet.height as f32,
            &to_pdf_rect(&panel, &layout.sheet),
            PX_PER_PT,
        ),
        &render(pdfium, &source, 0, PX_PER_PT),
        "rotated page in a panel of its reported size",
    );
}

/// Pages turned by /Rotate 180 and 270, with a MediaBox away from the origin
/// and a TrimBox inset by a different amount on each side, show their trim
/// as it displays in a panel of their reported size. The reference is the
/// same page with its CropBox set to the trim, as PDFium renders it.
#[test]
fn half_and_three_quarter_turned_pages_away_from_the_origin() {
    let pdfium = pdfium();
    for (media, trim, rotation) in [
        (
            (100.0, 200.0, 400.0, 590.0),
            (105.0, 203.0, 393.0, 581.0),
            PdfPageRenderRotation::Degrees180,
        ),
        (
            (100.0, 200.0, 490.0, 500.0),
            (103.0, 205.0, 481.0, 493.0),
            PdfPageRenderRotation::Degrees270,
        ),
    ] {
        let page = fixture_pdf(
            pdfium,
            &[FixturePage {
                media,
                trim: Some(trim),
                bleed: None,
                label: 1,
            }],
        );
        let source = with_rotation(pdfium, &page, 0, rotation);
        let reference = with_crop(pdfium, &source, 0, trim);

        let size = page_sizes(pdfium, &source).unwrap()[0].displayed_trim_size();
        assert_eq!(size, (288.0, 378.0), "{rotation:?}");

        let panel = layout::Rect {
            x: 18.0,
            y: 18.0,
            width: f64::from(size.0),
            height: f64::from(size.1),
        };
        let mut layout = worked_example();
        layout.sheets = vec![Sheet {
            front: SheetSide {
                placements: vec![placement(panel, 0)],
                guides: SideMarks::default(),
                marks: SideMarks::default(),
            },
            back: SheetSide {
                placements: vec![],
                guides: SideMarks::default(),
                marks: SideMarks::default(),
            },
        }];

        let pdf = export_pdf(&source, &layout);

        let rendered = render(pdfium, &pdf, 0, PX_PER_PT);
        assert_images_match(
            &crop_region(
                &rendered,
                layout.sheet.height as f32,
                &to_pdf_rect(&panel, &layout.sheet),
                PX_PER_PT,
            ),
            &render(pdfium, &reference, 0, PX_PER_PT),
            &format!("{rotation:?} page away from the origin"),
        );
    }
}

/// A page whose CropBox shows 288x378 of its 400x500 MediaBox reports the
/// cropped size, and a panel of that size shows the cropped page at scale 1.
#[test]
fn cropped_page_fills_a_panel_of_its_reported_size() {
    let pdfium = pdfium();
    let page = fixture_pdf(
        pdfium,
        &[FixturePage {
            media: (0.0, 0.0, 400.0, 500.0),
            trim: None,
            bleed: None,
            label: 1,
        }],
    );
    let source = with_crop(pdfium, &page, 0, (50.0, 50.0, 338.0, 428.0));

    let size = page_sizes(pdfium, &source).unwrap()[0].displayed_trim_size();
    assert_eq!(size, (288.0, 378.0));

    let panel = layout::Rect {
        x: 18.0,
        y: 18.0,
        width: f64::from(size.0),
        height: f64::from(size.1),
    };
    let mut layout = worked_example();
    layout.sheets = vec![Sheet {
        front: SheetSide {
            placements: vec![placement(panel, 0)],
            guides: SideMarks::default(),
            marks: SideMarks::default(),
        },
        back: SheetSide {
            placements: vec![],
            guides: SideMarks::default(),
            marks: SideMarks::default(),
        },
    }];

    let pdf = export_pdf(&source, &layout);

    let rendered = render(pdfium, &pdf, 0, PX_PER_PT);
    assert_images_match(
        &crop_region(
            &rendered,
            layout.sheet.height as f32,
            &to_pdf_rect(&panel, &layout.sheet),
            PX_PER_PT,
        ),
        &render(pdfium, &source, 0, PX_PER_PT),
        "cropped page in a panel of its reported size",
    );
}

#[test]
fn printed_annotations_on_placed_pages_are_reported() {
    let pdfium = pdfium();
    // Page 2 gets two printed annotations, page 3 one that does not print.
    let source = with_square_annotation(pdfium, source(), 1, true);
    let source = with_square_annotation(pdfium, &source, 1, true);
    let source = with_square_annotation(pdfium, &source, 2, false);

    let output = export(
        pdfium,
        &source,
        &worked_example(),
        &ExportOptions::default(),
    )
    .unwrap();

    assert_eq!(
        output.warnings,
        ["page 2 has 2 annotation(s) or form field(s) that are not included in the output"]
    );
}

#[test]
fn form_fields_on_placed_pages_are_reported_whether_or_not_they_print() {
    // Page 4 gets a printable text field, page 5 one without the print flag.
    let source = with_text_field(&with_text_field(source(), 3, true), 4, false);

    let output = export(
        pdfium(),
        &source,
        &worked_example(),
        &ExportOptions::default(),
    )
    .unwrap();

    assert_eq!(
        output.warnings,
        [
            "page 4 has 1 annotation(s) or form field(s) that are not included in the output",
            "page 5 has 1 annotation(s) or form field(s) that are not included in the output",
        ]
    );
}

#[test]
fn annotations_on_pages_the_layout_does_not_place_are_not_reported() {
    let pdfium = pdfium();
    let source = with_square_annotation(pdfium, source(), 1, true);
    let mut layout = worked_example();
    for side in layout
        .sheets
        .iter_mut()
        .flat_map(|s| [&mut s.front, &mut s.back])
    {
        for placement in &mut side.placements {
            if placement.pdf_page == Some(1) {
                placement.pdf_page = None;
            }
        }
    }

    let output = export(pdfium, &source, &layout, &ExportOptions::default()).unwrap();

    assert_eq!(output.warnings, Vec::<String>::new());
}

#[test]
fn layout_with_an_error_is_refused_before_reading_the_pdf() {
    let mut layout = worked_example();
    layout.issues.push(Issue {
        code: "piece-does-not-fit".to_string(),
        severity: "error".to_string(),
        message: "a piece does not fit on the sheet".to_string(),
        data: None,
    });

    let result = export(pdfium(), b"not a pdf", &layout, &ExportOptions::default());

    match result {
        Err(ExportError::LayoutHasErrors(messages)) => {
            assert_eq!(messages, ["a piece does not fit on the sheet"]);
        }
        other => panic!("expected LayoutHasErrors, got {:?}", other.map(|_| ())),
    }
}

#[test]
fn layout_warnings_do_not_stop_the_export() {
    let mut layout = worked_example();
    layout.issues.push(Issue {
        code: "spacing-reduces-fit".to_string(),
        severity: "warning".to_string(),
        message: "spacing reduces fit".to_string(),
        data: None,
    });

    assert!(export(pdfium(), source(), &layout, &ExportOptions::default()).is_ok());
}

#[test]
fn page_beyond_the_source_is_out_of_range() {
    let mut layout = worked_example();
    layout.sheets[3].back.placements[2].pdf_page = Some(PAGE_COUNT);

    let result = export(pdfium(), source(), &layout, &ExportOptions::default());

    match result {
        Err(ExportError::PageOutOfRange {
            pdf_page,
            page_count,
        }) => assert_eq!((pdf_page, page_count), (PAGE_COUNT, PAGE_COUNT)),
        other => panic!("expected PageOutOfRange, got {:?}", other.map(|_| ())),
    }
}

#[test]
fn input_that_is_not_a_pdf() {
    let result = export(
        pdfium(),
        b"not a pdf",
        &worked_example(),
        &ExportOptions::default(),
    );
    assert!(matches!(result, Err(ExportError::NotAPdf)));
}

fn placement(content: layout::Rect, rotation: u16) -> PagePlacement {
    PagePlacement {
        pdf_page: Some(0),
        part_index: 0,
        part_page: 0,
        panel: content,
        content,
        clip: content,
        rotation,
    }
}

/// Every stream object in `doc` whose `/Subtype` is `subtype`.
fn streams_of_subtype<'a>(
    doc: &'a Document,
    subtype: &'a [u8],
) -> impl Iterator<Item = &'a lopdf::Stream> {
    doc.objects
        .values()
        .filter_map(|object: &Object| object.as_stream().ok())
        .filter(move |stream| {
            stream.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(subtype)
        })
}
