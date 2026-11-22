//! Fixture PDFs and rendering shared by the integration tests.
// Each test crate uses a different subset of these helpers.
#![allow(dead_code)]

use image::{Rgb, RgbImage};
use lopdf::{Document, ObjectId, dictionary};
use pdf_export::{geometry, pdfium};
use pdfium_render::prelude::*;
use std::sync::OnceLock;

/// The process-wide PDFium binding. PDFium can only be bound once per
/// process, so every test shares this one.
pub fn pdfium() -> &'static Pdfium {
    static PDFIUM: OnceLock<Pdfium> = OnceLock::new();
    PDFIUM.get_or_init(|| pdfium::load().expect("could not load PDFium; run `make fetch-pdfium`"))
}

/// A box as `(left, bottom, right, top)` in PDF points, the order of a PDF
/// rectangle array.
pub type PdfBox = (f32, f32, f32, f32);

/// One page of a fixture PDF.
#[derive(Clone, Copy)]
pub struct FixturePage {
    pub media: PdfBox,
    /// The TrimBox; `None` leaves it unset, so trim falls back to `media`.
    pub trim: Option<PdfBox>,
    /// The BleedBox; `None` leaves it unset.
    pub bleed: Option<PdfBox>,
    pub label: u32,
}

/// An axis-aligned rectangle in PDF points.
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
}

impl Rect {
    pub fn new(left: f32, bottom: f32, right: f32, top: f32) -> Self {
        Rect {
            left,
            bottom,
            right,
            top,
        }
    }

    /// Whether `(x, y)` is inside this rectangle grown by `margin` on every
    /// side (a negative margin shrinks it).
    pub fn contains(&self, x: f32, y: f32, margin: f32) -> bool {
        x > self.left - margin
            && x < self.right + margin
            && y > self.bottom - margin
            && y < self.top + margin
    }
}

/// Builds a PDF with one page per `FixturePage`. Each page has a
/// MediaBox-sized background in a colour derived from its label, a 1-pt black
/// outline of its trim box (a vector path), its label as Helvetica text, a
/// 16x16 RGB image whose top-left corner is the trim box's top-left, and an
/// [`OFF_CENTRE_BLOCK`] a quarter of the trim's width and height, inset an
/// eighth from the trim's top-left. The block is the same on every page and
/// sits off every axis of symmetry, so a page turned or shifted the wrong way
/// differs over thousands of pixels.
pub fn fixture_pdf(pdfium: &Pdfium, pages: &[FixturePage]) -> Vec<u8> {
    let mut document = pdfium.create_new_pdf().unwrap();
    let helvetica = document.fonts_mut().helvetica();
    for fixture in pages {
        let (left, bottom, right, top) = fixture.media;
        let media = PdfRect::new_from_values(bottom, left, top, right);
        let (trim_left, trim_bottom, trim_right, trim_top) = fixture.trim.unwrap_or(fixture.media);
        let trim = PdfRect::new_from_values(trim_bottom, trim_left, trim_top, trim_right);

        let mut page = document
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::Custom(
                PdfPoints::new(right - left),
                PdfPoints::new(top - bottom),
            ))
            .unwrap();
        page.boundaries_mut().set_media(media).unwrap();
        if fixture.trim.is_some() {
            page.boundaries_mut().set_trim(trim).unwrap();
        }
        if let Some((l, b, r, t)) = fixture.bleed {
            let bleed = PdfRect::new_from_values(b, l, t, r);
            page.boundaries_mut().set_bleed(bleed).unwrap();
        }

        let objects = page.objects_mut();
        objects
            .create_path_object_rect(media, None, None, Some(label_colour(fixture.label)))
            .unwrap();
        objects
            .create_path_object_rect(trim, Some(PdfColor::BLACK), Some(PdfPoints::new(1.0)), None)
            .unwrap();
        let (trim_width, trim_height) = (trim_right - trim_left, trim_top - trim_bottom);
        let block_left = trim_left + trim_width / 8.0;
        let block_top = trim_top - trim_height / 8.0;
        objects
            .create_path_object_rect(
                PdfRect::new_from_values(
                    block_top - trim_height / 4.0,
                    block_left,
                    block_top,
                    block_left + trim_width / 4.0,
                ),
                None,
                None,
                Some(OFF_CENTRE_BLOCK),
            )
            .unwrap();
        objects
            .create_text_object(
                PdfPoints::new(trim_left + 24.0),
                PdfPoints::new(trim_bottom + 24.0),
                fixture.label.to_string(),
                helvetica,
                PdfPoints::new(24.0),
            )
            .unwrap();
        objects
            .create_image_object(
                PdfPoints::new(trim_left),
                PdfPoints::new(trim_top - 16.0),
                &checkerboard().into(),
                Some(PdfPoints::new(16.0)),
                Some(PdfPoints::new(16.0)),
            )
            .unwrap();
    }
    document.save_to_bytes().unwrap()
}

/// The 76-page book the export tests impose: 288x378 pages with no TrimBox,
/// labelled 1 to 76.
pub fn book_pdf(pdfium: &Pdfium) -> Vec<u8> {
    let pages: Vec<FixturePage> = (1..=76)
        .map(|label| FixturePage {
            media: (0.0, 0.0, 288.0, 378.0),
            trim: None,
            bleed: None,
            label,
        })
        .collect();
    fixture_pdf(pdfium, &pages)
}

/// `image` turned `rotation` degrees clockwise.
pub fn turned(image: &RgbImage, rotation: u16) -> RgbImage {
    match rotation {
        0 => image.clone(),
        90 => image::imageops::rotate90(image),
        180 => image::imageops::rotate180(image),
        _ => image::imageops::rotate270(image),
    }
}

/// `pdf` with page `page`'s /Rotate set to `rotation`.
pub fn with_rotation(
    pdfium: &Pdfium,
    pdf: &[u8],
    page: u16,
    rotation: PdfPageRenderRotation,
) -> Vec<u8> {
    let document = pdfium.load_pdf_from_byte_slice(pdf, None).unwrap();
    document
        .pages()
        .get(i32::from(page))
        .unwrap()
        .set_rotation(rotation);
    document.save_to_bytes().unwrap()
}

/// `pdf` with page `page`'s CropBox set to `crop`.
pub fn with_crop(pdfium: &Pdfium, pdf: &[u8], page: u16, crop: PdfBox) -> Vec<u8> {
    let document = pdfium.load_pdf_from_byte_slice(pdf, None).unwrap();
    let (left, bottom, right, top) = crop;
    document
        .pages()
        .get(i32::from(page))
        .unwrap()
        .boundaries_mut()
        .set_crop(PdfRect::new_from_values(bottom, left, top, right))
        .unwrap();
    document.save_to_bytes().unwrap()
}

/// `pdf` with a blue Square annotation added to page `page`, flagged to
/// print when `printed`.
pub fn with_square_annotation(pdfium: &Pdfium, pdf: &[u8], page: u16, printed: bool) -> Vec<u8> {
    let document = pdfium.load_pdf_from_byte_slice(pdf, None).unwrap();
    let mut page = document.pages().get(i32::from(page)).unwrap();
    let mut square = page.annotations_mut().create_square_annotation().unwrap();
    square
        .set_bounds(PdfRect::new_from_values(250.0, 150.0, 290.0, 230.0))
        .unwrap();
    square
        .set_stroke_color(PdfColor::new(0, 0, 255, 255))
        .unwrap();
    square.set_is_printed(printed).unwrap();
    document.save_to_bytes().unwrap()
}

/// `pdf` with `group` set as page `page`'s /Group, after `extra` objects are
/// added with the ids they are given; `group` is built from those ids.
pub fn with_group(
    pdf: &[u8],
    page: u32,
    extra: Vec<lopdf::Object>,
    group: impl FnOnce(&[ObjectId]) -> lopdf::Object,
) -> Vec<u8> {
    let mut doc = Document::load_mem(pdf).unwrap();
    let ids: Vec<ObjectId> = extra
        .into_iter()
        .map(|object| doc.add_object(object))
        .collect();
    let page_id = doc.get_pages()[&(page + 1)];
    doc.get_dictionary_mut(page_id)
        .unwrap()
        .set("Group", group(&ids));
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}

/// `pdf` with a text form field on page `page`: a Widget annotation in the
/// page's /Annots and the document's /AcroForm, flagged to print when
/// `printed`.
pub fn with_text_field(pdf: &[u8], page: u32, printed: bool) -> Vec<u8> {
    let mut doc = Document::load_mem(pdf).unwrap();
    let page_id = doc.get_pages()[&(page + 1)];
    let mut widget = dictionary! {
        "Type" => "Annot",
        "Subtype" => "Widget",
        "FT" => "Tx",
        "T" => lopdf::Object::string_literal(format!("field{page}")),
        "V" => lopdf::Object::string_literal("value"),
        "Rect" => vec![20.into(), 100.into(), 180.into(), 125.into()],
        "P" => page_id,
    };
    if printed {
        widget.set("F", 4);
    }
    let widget = doc.add_object(widget);
    let page_dict = doc.get_dictionary_mut(page_id).unwrap();
    match page_dict.get_mut(b"Annots") {
        Ok(lopdf::Object::Array(annots)) => annots.push(widget.into()),
        _ => page_dict.set("Annots", vec![lopdf::Object::Reference(widget)]),
    }
    let catalog = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
    let catalog = doc.get_dictionary_mut(catalog).unwrap();
    match catalog.get_mut(b"AcroForm") {
        Ok(lopdf::Object::Dictionary(form)) => match form.get_mut(b"Fields") {
            Ok(lopdf::Object::Array(fields)) => fields.push(widget.into()),
            _ => unreachable!("AcroForm without Fields"),
        },
        _ => catalog.set(
            "AcroForm",
            dictionary! { "Fields" => vec![lopdf::Object::Reference(widget)] },
        ),
    }
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes).unwrap();
    bytes
}

/// Renders page `page` of `pdf` at `px_per_pt` pixels per point.
pub fn render(pdfium: &Pdfium, pdf: &[u8], page: u16, px_per_pt: f32) -> RgbImage {
    let document = pdfium.load_pdf_from_byte_slice(pdf, None).unwrap();
    let page = document.pages().get(i32::from(page)).unwrap();
    let config = PdfRenderConfig::new().set_target_size(
        (page.width().value * px_per_pt).round() as Pixels,
        (page.height().value * px_per_pt).round() as Pixels,
    );
    page.render_with_config(&config)
        .unwrap()
        .as_image()
        .unwrap()
        .to_rgb8()
}

/// The pixels of `region` (PDF points, y-up) in `image`, a render of a page
/// `page_height` points tall at `px_per_pt`. The region's edges are rounded to
/// whole pixels.
pub fn crop_region(
    image: &RgbImage,
    page_height: f32,
    region: &geometry::PdfBox,
    px_per_pt: f32,
) -> RgbImage {
    let px = |pt: f32| (pt * px_per_pt).round() as u32;
    let top = page_height - region.bottom - region.height;
    image::imageops::crop_imm(
        image,
        px(region.left),
        px(top),
        px(region.width),
        px(region.height),
    )
    .to_image()
}

/// Asserts `actual` and `expected` have the same size and that every channel
/// is within 8 of the expected value on at least 99.9% of pixels, so
/// anti-aliasing differences cannot cause false failures.
pub fn assert_images_match(actual: &RgbImage, expected: &RgbImage, what: &str) {
    assert_eq!(actual.dimensions(), expected.dimensions(), "{what}: size");
    let mismatched = actual
        .pixels()
        .zip(expected.pixels())
        .filter(|(a, e)| a.0.iter().zip(e.0).any(|(&a, e)| a.abs_diff(e) > 8))
        .count();
    let total = actual.pixels().len();
    assert!(
        mismatched * 1000 <= total,
        "{what}: {mismatched} of {total} pixels differ"
    );
}

/// The dark brown of every fixture page's off-centre block. Its red channel
/// stays above 60 so outline detection never mistakes it for the black trim
/// outline.
pub const OFF_CENTRE_BLOCK: PdfColor = PdfColor::new(90, 50, 20, 255);

/// A mid-tone colour unique to small labels; never white or black, so painted
/// pixels are always distinguishable from an empty sheet and from the outline.
pub fn label_colour(label: u32) -> PdfColor {
    let channel = |seed: u32| (64 + (label.wrapping_mul(seed) % 128)) as u8;
    PdfColor::new(channel(37), channel(73), channel(109), 255)
}

/// A 16x16 red and blue checkerboard of 4x4-pixel squares.
fn checkerboard() -> RgbImage {
    RgbImage::from_fn(16, 16, |x, y| {
        if (x / 4 + y / 4) % 2 == 0 {
            Rgb([200, 30, 30])
        } else {
            Rgb([30, 30, 200])
        }
    })
}

/// The page's content streams merged the way PDFium merges them into a form
/// XObject: each stream decoded, followed by a newline, in order. The
/// operators stay byte-for-byte the source's; only the boundaries between
/// streams become whitespace.
pub fn merged_page_content(doc: &Document, page: ObjectId) -> Vec<u8> {
    doc.get_page_contents(page)
        .into_iter()
        .flat_map(|id| {
            let mut content = decoded(doc.get_object(id).unwrap().as_stream().unwrap());
            content.push(b'\n');
            content
        })
        .collect()
}

/// The stream's bytes with every filter undone; fails rather than falling
/// back to the raw bytes.
pub fn decoded(stream: &lopdf::Stream) -> Vec<u8> {
    if stream.dict.get(b"Filter").is_ok() {
        stream.decompressed_content().unwrap()
    } else {
        stream.content.clone()
    }
}
