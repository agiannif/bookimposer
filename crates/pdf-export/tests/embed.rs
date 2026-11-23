//! PDFium's page-to-form-XObject copy keeps page content intact, nesting that
//! XObject inside a clip-sized temporary page clips it, and `embed::place`
//! uses both to put a source page on a sheet.

mod support;

use lopdf::{Dictionary, Document, Object, ObjectId};
use pdf_export::embed;
use pdf_export::geometry::{PdfBox, to_pdf_rect};
use pdf_export::layout::{self, PagePlacement, Size};
use pdfium_render::prelude::*;
use support::{
    FixturePage, Rect, assert_images_match, crop_region, decoded, fixture_pdf, label_colour,
    merged_page_content, pdfium, render,
};

const PX_PER_PT: f32 = 4.0;
const WHITE: [u8; 3] = [255, 255, 255];

#[test]
fn xobject_preserves_content_bytes() {
    let pdfium = pdfium();
    let source = fixture_pdf(
        pdfium,
        &[FixturePage {
            media: (0.0, 0.0, 306.0, 396.0),
            trim: Some((18.0, 18.0, 288.0, 378.0)),
            bleed: None,
            label: 1,
        }],
    );

    let output = embed_on_new_page(pdfium, &source, 306.0, 396.0, (0.0, 0.0));

    let source_doc = Document::load_mem(&source).unwrap();
    let source_page = first_page_id(&source_doc);
    let output_doc = Document::load_mem(&output).unwrap();
    let form = single_xobject(
        &output_doc,
        page_resources(&output_doc, first_page_id(&output_doc)),
        b"Form",
    );

    assert_eq!(
        decoded(form),
        merged_page_content(&source_doc, source_page),
        "form XObject content differs from the source page content"
    );

    let source_image = single_xobject(
        &source_doc,
        page_resources(&source_doc, source_page),
        b"Image",
    );
    let form_resources = output_doc
        .dereference(form.dict.get(b"Resources").unwrap())
        .unwrap()
        .1
        .as_dict()
        .unwrap();
    let output_image = single_xobject(&output_doc, form_resources, b"Image");
    assert_eq!(
        output_image.content, source_image.content,
        "image XObject stream bytes were re-encoded"
    );
}

#[test]
fn xobject_bbox_clips_to_media_box() {
    let pdfium = pdfium();
    let source = with_overflow(
        pdfium,
        &fixture_pdf(
            pdfium,
            &[FixturePage {
                media: (0.0, 0.0, 306.0, 396.0),
                trim: None,
                bleed: None,
                label: 2,
            }],
        ),
    );

    let output = embed_on_new_page(pdfium, &source, 612.0, 792.0, (0.0, 0.0));

    let image = render(pdfium, &output, 0, PX_PER_PT);
    assert_painted_only_inside(&image, 792.0, Rect::new(0.0, 0.0, 306.0, 396.0));
}

#[test]
fn nested_page_clips() {
    let pdfium = pdfium();
    let source = fixture_pdf(
        pdfium,
        &[FixturePage {
            media: (0.0, 0.0, 306.0, 396.0),
            trim: None,
            bleed: None,
            label: 3,
        }],
    );

    // The 100x100 window shows fixture points (100..200, 100..200); the
    // fixture overflows it on all four sides.
    let window = embed_on_new_page(pdfium, &source, 100.0, 100.0, (-100.0, -100.0));
    let output = embed_on_new_page(pdfium, &window, 300.0, 300.0, (50.0, 50.0));

    let image = render(pdfium, &output, 0, PX_PER_PT);
    assert_painted_only_inside(&image, 300.0, Rect::new(50.0, 50.0, 150.0, 150.0));
}

const SHEET: Size = Size {
    width: 612.0,
    height: 792.0,
};

/// A 288x378 page whose trim box is its media box.
const PLAIN_TRIM: PdfBox = PdfBox {
    left: 0.0,
    bottom: 0.0,
    width: 288.0,
    height: 378.0,
};

/// A 306x396 page with a 9 pt bleed around a 288x378 trim box.
const BLEED_PAGE: FixturePage = FixturePage {
    media: (0.0, 0.0, 306.0, 396.0),
    trim: Some((9.0, 9.0, 297.0, 387.0)),
    bleed: None,
    label: 1,
};
const BLEED_TRIM: PdfBox = PdfBox {
    left: 9.0,
    bottom: 9.0,
    width: 288.0,
    height: 378.0,
};

/// The panel every placement test uses, in layout coordinates.
const PANEL: layout::Rect = layout::Rect {
    x: 18.0,
    y: 18.0,
    width: 288.0,
    height: 378.0,
};

#[test]
fn rotations_land_upright() {
    let pdfium = pdfium();
    let source = fixture_pdf(
        pdfium,
        &[FixturePage {
            media: (0.0, 0.0, 288.0, 378.0),
            trim: None,
            bleed: None,
            label: 1,
        }],
    );
    let alone = render(pdfium, &source, 0, PX_PER_PT);

    for rotation in [0, 90, 180, 270] {
        let content = if rotation % 180 == 0 {
            PANEL
        } else {
            layout::Rect {
                width: PANEL.height,
                height: PANEL.width,
                ..PANEL
            }
        };
        let sheet = place_on_sheet(&source, &placement(content, content, rotation), &PLAIN_TRIM);

        let rendered = render(pdfium, &sheet, 0, PX_PER_PT);
        let region = to_pdf_rect(&content, &SHEET);
        let expected = match rotation {
            0 => alone.clone(),
            90 => image::imageops::rotate90(&alone),
            180 => image::imageops::rotate180(&alone),
            _ => image::imageops::rotate270(&alone),
        };
        assert_images_match(
            &crop_region(&rendered, SHEET.height as f32, &region, PX_PER_PT),
            &expected,
            &format!("rotation {rotation}"),
        );
    }
}

#[test]
fn media_box_away_from_the_origin() {
    let pdfium = pdfium();
    let source = fixture_pdf(
        pdfium,
        &[FixturePage {
            media: (10.0, 20.0, 298.0, 398.0),
            trim: None,
            bleed: None,
            label: 1,
        }],
    );
    let trim = PdfBox {
        left: 10.0,
        bottom: 20.0,
        width: 288.0,
        height: 378.0,
    };
    let sheet = place_on_sheet(&source, &placement(PANEL, PANEL, 0), &trim);

    let rendered = render(pdfium, &sheet, 0, PX_PER_PT);
    assert_images_match(
        &crop_region(
            &rendered,
            SHEET.height as f32,
            &to_pdf_rect(&PANEL, &SHEET),
            PX_PER_PT,
        ),
        &render(pdfium, &source, 0, PX_PER_PT),
        "page with an offset MediaBox",
    );
}

#[test]
fn offset_trim_box() {
    let pdfium = pdfium();
    let source = fixture_pdf(pdfium, &[BLEED_PAGE]);
    let sheet = place_on_sheet(&source, &placement(PANEL, PANEL, 0), &BLEED_TRIM);

    let image = render(pdfium, &sheet, 0, PX_PER_PT);
    let px = |pt: f64| (pt as f32 * PX_PER_PT) as u32;
    let (left, top) = (px(PANEL.x), px(PANEL.y));
    let (right, bottom) = (px(PANEL.x + PANEL.width), px(PANEL.y + PANEL.height));
    let (middle_x, middle_y) = ((left + right) / 2, (top + bottom) / 2);
    let is_outline = |x: u32, y: u32| image.get_pixel(x, y).0.iter().all(|&c| c < 60);

    let row: Vec<u32> = (0..image.width())
        .filter(|&x| is_outline(x, middle_y))
        .collect();
    let column: Vec<u32> = (0..image.height())
        .filter(|&y| is_outline(middle_x, y))
        .collect();
    let edges = [
        ("left", row[0], left),
        ("right", row[row.len() - 1], right - 1),
        ("top", column[0], top),
        ("bottom", column[column.len() - 1], bottom - 1),
    ];
    for (edge, found, expected) in edges {
        assert!(
            found.abs_diff(expected) <= 1,
            "trim outline's {edge} edge at pixel {found}, panel edge at {expected}"
        );
    }
}

#[test]
fn clip_contains_bleed() {
    let pdfium = pdfium();
    let source = fixture_pdf(pdfium, &[BLEED_PAGE]);
    let clip = layout::Rect {
        x: PANEL.x - 9.0,
        width: PANEL.width + 9.0,
        ..PANEL
    };
    let sheet = place_on_sheet(&source, &placement(PANEL, clip, 0), &BLEED_TRIM);

    let image = render(pdfium, &sheet, 0, PX_PER_PT);
    // Everything outside the clip is blank, so nothing shows right of the
    // panel's right edge (the clip's right edge) or above and below it.
    assert_painted_only_inside(
        &image,
        SHEET.height as f32,
        Rect::new(9.0, 396.0, 306.0, 774.0),
    );

    // The 9 pt strip left of the panel shows the source's bleed background.
    // The trim outline's stroke reaches 0.5 pt into it, so stop 1 pt short.
    let background = label_colour(BLEED_PAGE.label);
    let expected = [background.red(), background.green(), background.blue()];
    let strip_x = (9.0 * PX_PER_PT) as u32..(17.0 * PX_PER_PT) as u32;
    let strip_y = (19.0 * PX_PER_PT) as u32..(395.0 * PX_PER_PT) as u32;
    let off_colour = strip_x
        .flat_map(|x| strip_y.clone().map(move |y| (x, y)))
        .filter(|&(x, y)| {
            image
                .get_pixel(x, y)
                .0
                .iter()
                .zip(expected)
                .any(|(&c, e)| c.abs_diff(e) > 8)
        })
        .count();
    assert_eq!(
        off_colour, 0,
        "bleed strip pixels not in the background colour"
    );
}

#[test]
fn place_adds_one_object_and_no_pages_to_the_sheet() {
    let pdfium = pdfium();
    let source_bytes = fixture_pdf(pdfium, &[BLEED_PAGE]);
    let source = pdfium
        .load_pdf_from_byte_slice(&source_bytes, None)
        .unwrap();
    let mut source_page = source.pages().get(0).unwrap();
    let mut sheet_doc = pdfium.create_new_pdf().unwrap();
    let mut sheet_page = new_sheet_page(&mut sheet_doc);

    embed::place(
        pdfium,
        &mut sheet_doc,
        &mut sheet_page,
        &mut source_page,
        &placement(PANEL, PANEL, 0),
        &SHEET,
        &BLEED_TRIM,
    )
    .unwrap();

    assert_eq!(sheet_doc.pages().len(), 1);
    let objects: Vec<_> = sheet_page
        .objects()
        .iter()
        .map(|o| o.object_type())
        .collect();
    assert_eq!(objects, [PdfPageObjectType::XObjectForm]);
}

fn placement(content: layout::Rect, clip: layout::Rect, rotation: u16) -> PagePlacement {
    PagePlacement {
        pdf_page: Some(0),
        part_index: 0,
        part_page: 0,
        panel: PANEL,
        content,
        clip,
        rotation,
    }
}

fn new_sheet_page<'a>(sheet_doc: &mut PdfDocument<'a>) -> PdfPage<'a> {
    sheet_doc
        .pages_mut()
        .create_page_at_end(PdfPagePaperSize::Custom(
            PdfPoints::new(SHEET.width as f32),
            PdfPoints::new(SHEET.height as f32),
        ))
        .unwrap()
}

/// Places page 0 of `source` on a new sheet and returns the saved sheet PDF.
fn place_on_sheet(source: &[u8], placement: &PagePlacement, trim: &PdfBox) -> Vec<u8> {
    let pdfium = pdfium();
    let source = pdfium.load_pdf_from_byte_slice(source, None).unwrap();
    let mut source_page = source.pages().get(0).unwrap();
    let mut sheet_doc = pdfium.create_new_pdf().unwrap();
    let mut sheet_page = new_sheet_page(&mut sheet_doc);
    embed::place(
        pdfium,
        &mut sheet_doc,
        &mut sheet_page,
        &mut source_page,
        placement,
        &SHEET,
        trim,
    )
    .unwrap();
    sheet_doc.save_to_bytes().unwrap()
}

/// Copies page 0 of `source` as a form XObject onto a new `width` x `height`
/// page, translated by `offset`, and returns the saved document.
fn embed_on_new_page(
    pdfium: &Pdfium,
    source: &[u8],
    width: f32,
    height: f32,
    offset: (f32, f32),
) -> Vec<u8> {
    let source = pdfium.load_pdf_from_byte_slice(source, None).unwrap();
    let source_page = source.pages().get(0).unwrap();
    let mut output = pdfium.create_new_pdf().unwrap();
    let mut xobject = source_page
        .objects()
        .copy_into_x_object_form_object(&mut output)
        .unwrap();
    xobject
        .translate(PdfPoints::new(offset.0), PdfPoints::new(offset.1))
        .unwrap();
    let mut page = output
        .pages_mut()
        .create_page_at_end(PdfPagePaperSize::Custom(
            PdfPoints::new(width),
            PdfPoints::new(height),
        ))
        .unwrap();
    page.objects_mut().add_object(xobject).unwrap();
    output.save_to_bytes().unwrap()
}

/// Adds a filled rectangle that extends past page 0's MediaBox on the right
/// and the top, so clipping to the MediaBox is observable.
fn with_overflow(pdfium: &Pdfium, pdf: &[u8]) -> Vec<u8> {
    let document = pdfium.load_pdf_from_byte_slice(pdf, None).unwrap();
    let mut page = document.pages().get(0).unwrap();
    page.objects_mut()
        .create_path_object_rect(
            PdfRect::new_from_values(200.0, 200.0, 600.0, 500.0),
            None,
            None,
            Some(PdfColor::new(220, 0, 0, 255)),
        )
        .unwrap();
    document.save_to_bytes().unwrap()
}

/// Asserts every pixel inside `rect` (PDF points, y-up) is painted and every
/// pixel outside it is white. Pixels within one pixel of the edge are skipped
/// so anti-aliasing cannot cause false failures.
fn assert_painted_only_inside(image: &image::RgbImage, page_height: f32, rect: Rect) {
    let edge = 1.0 / PX_PER_PT;
    let mut stray = Vec::new();
    let mut missing = Vec::new();
    for (px, py, pixel) in image.enumerate_pixels() {
        let x = (px as f32 + 0.5) / PX_PER_PT;
        let y = page_height - (py as f32 + 0.5) / PX_PER_PT;
        let painted = pixel.0 != WHITE;
        if rect.contains(x, y, -edge) && !painted {
            missing.push((x, y));
        } else if !rect.contains(x, y, edge) && painted {
            stray.push((x, y, pixel.0));
        }
    }
    assert!(
        stray.is_empty() && missing.is_empty(),
        "{} painted pixels outside {rect:?} (first: {:?}); {} white pixels inside (first: {:?})",
        stray.len(),
        stray.first(),
        missing.len(),
        missing.first()
    );
}

fn first_page_id(doc: &Document) -> ObjectId {
    *doc.get_pages().get(&1).unwrap()
}

fn page_resources(doc: &Document, page: ObjectId) -> &Dictionary {
    let page = doc.get_dictionary(page).unwrap();
    doc.dereference(page.get(b"Resources").unwrap())
        .unwrap()
        .1
        .as_dict()
        .unwrap()
}

/// The one XObject of the given `/Subtype` in `resources`.
fn single_xobject<'a>(
    doc: &'a Document,
    resources: &'a Dictionary,
    subtype: &[u8],
) -> &'a lopdf::Stream {
    let xobjects = doc
        .dereference(resources.get(b"XObject").unwrap())
        .unwrap()
        .1
        .as_dict()
        .unwrap();
    let matching: Vec<&lopdf::Stream> = xobjects
        .iter()
        .map(|(_, object)| doc.dereference(object).unwrap().1)
        .filter_map(|object: &Object| object.as_stream().ok())
        .filter(|stream| {
            stream.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(subtype)
        })
        .collect();
    assert_eq!(matching.len(), 1, "expected one {:?} XObject", subtype);
    matching[0]
}
