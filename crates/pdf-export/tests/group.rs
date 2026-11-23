//! A source page's transparency group (/Group) is carried onto the form
//! XObject that holds that page's content in the output.

mod support;

use lopdf::{Document, Object, ObjectId, Stream, dictionary};
use pdf_export::geometry::to_pdf_rect;
use pdf_export::group::{Carried, carry_page_groups};
use pdf_export::layout::{self, Layout};
use pdf_export::{ExportOptions, export};
use support::{
    assert_images_match, book_pdf, crop_region, decoded, merged_page_content, pdfium, render,
    turned, with_group,
};

const PX_PER_PT: f32 = 4.0;
/// The 0-based source page given a /Group.
const GROUPED: usize = 1;

fn worked_example() -> Layout {
    layout::parse(include_str!("data/worked-example.layout.json")).unwrap()
}

fn rgb_group() -> Object {
    Object::Dictionary(dictionary! {
        "Type" => "Group",
        "S" => "Transparency",
        "CS" => "DeviceRGB",
    })
}

fn export_bytes(source: &[u8]) -> Vec<u8> {
    let output = export(
        pdfium(),
        source,
        &worked_example(),
        &ExportOptions::default(),
    )
    .unwrap();
    assert_eq!(output.warnings, Vec::<String>::new());
    output.pdf
}

/// The output's form XObjects whose content is exactly source page
/// `pdf_page`'s content, with their /Group if any.
fn forms_of_page<'a>(
    output: &'a Document,
    source: &Document,
    pdf_page: usize,
) -> Vec<Option<&'a Object>> {
    let page = source.get_pages()[&(pdf_page as u32 + 1)];
    let content = merged_page_content(source, page);
    output
        .objects
        .values()
        .filter_map(|object| object.as_stream().ok())
        .filter(|stream| {
            stream.dict.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Form".as_slice())
        })
        .filter(|stream| decoded(stream) == content)
        .map(|stream| stream.dict.get(b"Group").ok())
        .collect()
}

fn resolved<'a>(doc: &'a Document, object: &'a Object) -> &'a Object {
    doc.dereference(object).unwrap().1
}

#[test]
fn transparency_group_is_carried_to_the_pages_form_only() {
    let book = book_pdf(pdfium());
    let source = with_group(&book, GROUPED as u32, vec![], |_| rgb_group());
    let pdf = export_bytes(&source);

    let (output, source_doc) = (
        Document::load_mem(&pdf).unwrap(),
        Document::load_mem(&source).unwrap(),
    );
    let grouped = forms_of_page(&output, &source_doc, GROUPED);
    assert_eq!(grouped.len(), 1, "forms holding page {GROUPED}'s content");
    assert_eq!(grouped[0].map(|g| resolved(&output, g)), Some(&rgb_group()));
    for pdf_page in (0..76).filter(|&p| p != GROUPED) {
        let forms = forms_of_page(&output, &source_doc, pdf_page);
        assert_eq!(forms, [None], "page {pdf_page}");
    }

    assert!(
        pdf.len() <= 2 * source.len() + 64 * 1024,
        "output is {} bytes, source {} bytes",
        pdf.len(),
        source.len()
    );

    // The grouped page still looks as it does on its own.
    let layout = worked_example();
    let (output_page, placement) = layout
        .sheets
        .iter()
        .flat_map(|sheet| [&sheet.front, &sheet.back])
        .enumerate()
        .find_map(|(index, side)| {
            side.placements
                .iter()
                .find(|p| p.pdf_page == Some(GROUPED))
                .map(|p| (index as u16, p))
        })
        .unwrap();
    let rendered = render(pdfium(), &pdf, output_page, PX_PER_PT);
    assert_images_match(
        &crop_region(
            &rendered,
            layout.sheet.height as f32,
            &to_pdf_rect(&placement.content, &layout.sheet),
            PX_PER_PT,
        ),
        &turned(
            &render(pdfium(), &source, GROUPED as u16, PX_PER_PT),
            placement.rotation,
        ),
        "grouped page",
    );
}

#[test]
fn group_colour_space_by_reference_is_copied_with_it() {
    let profile = b"stand-in ICC profile bytes".to_vec();
    let icc = Object::Stream(Stream::new(dictionary! { "N" => 3 }, profile.clone()));
    let book = book_pdf(pdfium());
    let source = with_group(&book, GROUPED as u32, vec![icc], |ids: &[ObjectId]| {
        Object::Dictionary(dictionary! {
            "S" => "Transparency",
            "CS" => vec![Object::Name(b"ICCBased".to_vec()), Object::Reference(ids[0])],
        })
    });
    let pdf = export_bytes(&source);

    let (output, source_doc) = (
        Document::load_mem(&pdf).unwrap(),
        Document::load_mem(&source).unwrap(),
    );
    let grouped = forms_of_page(&output, &source_doc, GROUPED);
    let group = resolved(&output, grouped[0].unwrap()).as_dict().unwrap();
    let cs = group.get(b"CS").unwrap().as_array().unwrap();
    assert_eq!(cs[0].as_name().unwrap(), b"ICCBased");
    let stream = resolved(&output, &cs[1]).as_stream().unwrap();
    assert_eq!(stream.content, profile);
    assert_eq!(stream.dict.get(b"N").unwrap().as_i64().unwrap(), 3);
}

#[test]
fn pages_without_a_group_get_none() {
    let pdf = export_bytes(&book_pdf(pdfium()));
    let output = Document::load_mem(&pdf).unwrap();
    let groups = output
        .objects
        .values()
        .filter_map(|object| object.as_stream().ok())
        .filter(|stream| stream.dict.get(b"Group").is_ok())
        .count();
    assert_eq!(groups, 0);
}

#[test]
fn source_lopdf_cannot_read_leaves_the_pdf_as_is() {
    let mut sheets = Document::load_mem(&export_bytes(&book_pdf(pdfium()))).unwrap();
    let before = sheets.objects.clone();

    let carried = carry_page_groups(b"%PDF-1.7 and nothing else", &mut sheets, &worked_example());

    assert!(
        matches!(carried, Ok(Carried::SourceUnreadable(_))),
        "{carried:?}"
    );
    assert_eq!(sheets.objects, before);
}
