//! Resources that source pages share are written once in the output, not once
//! per placement, and nothing else changes.

mod support;

use lopdf::{Document, Object, Stream, dictionary};
use pdf_export::dedupe::share_identical_objects;
use pdf_export::layout::{self, Layout};
use pdf_export::{ExportOptions, export};
use support::{decoded, pdfium, shared_resource_book, shared_resource_document};

const PAGES: u32 = 40;

/// The engine's imposition of a 40-page book into 5 signatures of 8 on
/// letter sheets.
fn layout() -> Layout {
    layout::parse(include_str!("data/shared-resources.layout.json")).unwrap()
}

fn export_bytes(source: &[u8]) -> Vec<u8> {
    let output = export(pdfium(), source, &layout(), &ExportOptions::default()).unwrap();
    assert_eq!(output.warnings, Vec::<String>::new());
    output.pdf
}

/// Every stream in `doc` whose /Subtype is `subtype`.
fn streams_of_subtype<'a>(doc: &'a Document, subtype: &'a [u8]) -> Vec<&'a Stream> {
    doc.objects
        .values()
        .filter_map(|object| object.as_stream().ok())
        .filter(|stream| {
            stream.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(subtype)
        })
        .collect()
}

fn fonts(doc: &Document) -> usize {
    doc.objects
        .values()
        .filter_map(|object| object.as_dict().ok())
        .filter(|dict| dict.get(b"Type").and_then(Object::as_name).ok() == Some(b"Font"))
        .count()
}

#[test]
fn shared_resources_are_written_once() {
    let source = shared_resource_book(PAGES, |_| 0);
    let pdf = export_bytes(&source);

    assert!(
        pdf.len() as f64 <= 1.25 * source.len() as f64 + 64.0 * 1024.0,
        "output is {} bytes, source {} bytes",
        pdf.len(),
        source.len()
    );
    let (output, source) = (
        Document::load_mem(&pdf).unwrap(),
        Document::load_mem(&source).unwrap(),
    );
    let images = streams_of_subtype(&output, b"Image");
    assert_eq!(images.len(), 1, "image streams");
    assert!(images[0].content == streams_of_subtype(&source, b"Image")[0].content);
    assert_eq!(fonts(&output), 1, "font dictionaries");
    // The source's shared form, which draws the image, is written once too
    // (PDFium compresses the raw source stream, so contents are compared decoded).
    let shared_form = decoded(streams_of_subtype(&source, b"Form")[0]);
    let copies = streams_of_subtype(&output, b"Form")
        .into_iter()
        .filter(|form| decoded(form) == shared_form)
        .count();
    assert_eq!(copies, 1, "copies of the shared form");
}

#[test]
fn different_images_are_never_merged() {
    // Every page has its own image; the shared form draws one more.
    let source = shared_resource_book(PAGES, |page| page + 1);
    let pdf = export_bytes(&source);

    let (output, source) = (
        Document::load_mem(&pdf).unwrap(),
        Document::load_mem(&source).unwrap(),
    );
    let source_images: Vec<&Vec<u8>> = streams_of_subtype(&source, b"Image")
        .into_iter()
        .map(|image| &image.content)
        .collect();
    assert_eq!(source_images.len(), PAGES as usize + 1);
    let output_images = streams_of_subtype(&output, b"Image");
    assert_eq!(output_images.len(), source_images.len(), "image streams");
    for content in source_images {
        let copies = output_images
            .iter()
            .filter(|image| &image.content == content)
            .count();
        assert_eq!(copies, 1, "copies of one source image");
    }
}

#[test]
fn a_document_without_duplicates_is_unchanged() {
    let mut doc = shared_resource_document(4, |page| page + 1);
    let before = doc.objects.clone();

    assert_eq!(share_identical_objects(&mut doc), 0);
    assert_eq!(doc.objects, before);
}

/// A document whose two pages are the same dictionary, `page`, in one page
/// tree; both draw one shared content stream.
fn two_identical_pages(page: lopdf::Dictionary) -> Document {
    let mut doc = Document::with_version("1.7");
    let pages = doc.new_object_id();
    let content = doc.add_object(Stream::new(dictionary! {}, b"0 0 m 10 10 l S".to_vec()));
    let mut page = page;
    page.set("Parent", pages);
    page.set("Contents", content);
    page.set("MediaBox", vec![0.into(), 0.into(), 100.into(), 100.into()]);
    let kids = vec![
        doc.add_object(page.clone()).into(),
        doc.add_object(page).into(),
    ];
    doc.objects.insert(
        pages,
        Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => 2 }),
    );
    let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
    doc.trailer.set("Root", catalog);
    doc
}

#[test]
fn identical_pages_stay_two_pages() {
    let mut doc = two_identical_pages(dictionary! { "Type" => "Page" });

    assert_eq!(share_identical_objects(&mut doc), 0);
    assert_eq!(doc.get_pages().len(), 2);
}

#[test]
fn pages_are_found_by_the_page_tree_not_by_their_type() {
    // /Type is required on a page, but a page missing it is still a page.
    let mut doc = two_identical_pages(dictionary! {});
    let before = doc.objects.clone();

    assert_eq!(share_identical_objects(&mut doc), 0);
    assert_eq!(doc.objects, before);
}

#[test]
fn merging_repeats_until_containers_of_merged_objects_match_too() {
    // Two fonts that differ only in which of two identical font files they
    // point to become one once the files are one.
    let mut doc = Document::with_version("1.7");
    let file = || Stream::new(dictionary! { "Length1" => 3 }, b"abc".to_vec());
    let (file_a, file_b) = (doc.add_object(file()), doc.add_object(file()));
    let font = |file| dictionary! { "Type" => "Font", "FontFile2" => file };
    let (font_a, font_b) = (doc.add_object(font(file_a)), doc.add_object(font(file_b)));
    let catalog = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Fonts" => vec![font_a.into(), font_b.into()],
    });
    doc.trailer.set("Root", catalog);

    assert_eq!(share_identical_objects(&mut doc), 2);
    let fonts = doc.get_dictionary(catalog).unwrap().get(b"Fonts").unwrap();
    assert_eq!(
        fonts.as_array().unwrap(),
        &vec![Object::Reference(font_a), Object::Reference(font_a)]
    );
    let file = doc
        .get_dictionary(font_a)
        .unwrap()
        .get(b"FontFile2")
        .unwrap();
    assert_eq!(file.as_reference().unwrap(), file_a);
}

#[test]
fn streams_with_equal_bytes_but_different_dictionaries_stay_apart() {
    let mut doc = Document::with_version("1.7");
    let a = doc.add_object(Stream::new(dictionary! { "N" => 1 }, b"same".to_vec()));
    let b = doc.add_object(Stream::new(dictionary! { "N" => 3 }, b"same".to_vec()));
    let catalog = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Streams" => vec![a.into(), b.into()],
    });
    doc.trailer.set("Root", catalog);

    assert_eq!(share_identical_objects(&mut doc), 0);
}
