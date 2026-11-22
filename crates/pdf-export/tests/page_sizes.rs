//! `page_sizes` reports each source page's trim, media and bleed boxes.

mod support;

use pdf_export::geometry::PdfBox;
use pdf_export::{ExportError, page_sizes};
use pdfium_render::prelude::PdfPageRenderRotation;
use support::{FixturePage, fixture_pdf, pdfium, with_crop, with_rotation};

fn pdf_box(left: f32, bottom: f32, width: f32, height: f32) -> PdfBox {
    PdfBox {
        left,
        bottom,
        width,
        height,
    }
}

#[test]
fn reports_trim_and_media_with_trim_falling_back_to_media() {
    let pdfium = pdfium();
    let page = |media, trim| FixturePage {
        media,
        trim,
        bleed: None,
        label: 1,
    };
    let plain = (0.0, 0.0, 288.0, 378.0);
    let source = fixture_pdf(
        pdfium,
        &[
            page((0.0, 0.0, 306.0, 396.0), Some((9.0, 9.0, 297.0, 387.0))),
            page(plain, None),
            page(plain, None),
        ],
    );

    let boxes = page_sizes(pdfium, &source).unwrap();

    assert_eq!(boxes.len(), 3);
    assert_eq!(boxes[0].trim, pdf_box(9.0, 9.0, 288.0, 378.0));
    assert_eq!(boxes[0].media, pdf_box(0.0, 0.0, 306.0, 396.0));
    let plain = pdf_box(0.0, 0.0, 288.0, 378.0);
    assert_eq!((boxes[1].trim, boxes[1].media), (plain, plain));
    assert_eq!((boxes[2].trim, boxes[2].media), (plain, plain));
}

#[test]
fn trim_falls_back_to_the_crop_box_before_the_media_box() {
    let pdfium = pdfium();
    let page = |trim| FixturePage {
        media: (0.0, 0.0, 400.0, 500.0),
        trim,
        bleed: None,
        label: 1,
    };
    let crop = (50.0, 50.0, 338.0, 428.0);
    let source = fixture_pdf(
        pdfium,
        &[
            page(None),
            page(Some((60.0, 60.0, 300.0, 400.0))),
            page(None),
        ],
    );
    let source = with_crop(pdfium, &with_crop(pdfium, &source, 0, crop), 1, crop);

    let boxes = page_sizes(pdfium, &source).unwrap();

    let cropped = pdf_box(50.0, 50.0, 288.0, 378.0);
    let media = pdf_box(0.0, 0.0, 400.0, 500.0);
    assert_eq!(
        (boxes[0].trim, boxes[0].crop, boxes[0].media),
        (cropped, cropped, media)
    );
    assert_eq!(boxes[0].displayed_trim_size(), (288.0, 378.0));
    assert_eq!(
        (boxes[1].trim, boxes[1].crop),
        (pdf_box(60.0, 60.0, 240.0, 340.0), cropped)
    );
    assert_eq!((boxes[2].trim, boxes[2].crop), (media, media));
}

#[test]
fn bleed_is_reported_only_when_the_page_defines_one() {
    let pdfium = pdfium();
    let page = |bleed| FixturePage {
        media: (0.0, 0.0, 306.0, 396.0),
        trim: Some((9.0, 9.0, 297.0, 387.0)),
        bleed,
        label: 1,
    };
    let source = fixture_pdf(pdfium, &[page(None), page(Some((4.0, 5.0, 300.0, 390.0)))]);

    let boxes = page_sizes(pdfium, &source).unwrap();

    assert_eq!(boxes[0].bleed, None);
    assert_eq!(boxes[1].bleed, Some(pdf_box(4.0, 5.0, 296.0, 385.0)));
}

#[test]
fn reports_each_page_rotation_with_boxes_as_stored() {
    let pdfium = pdfium();
    let page = FixturePage {
        media: (0.0, 0.0, 378.0, 288.0),
        trim: None,
        bleed: None,
        label: 1,
    };
    let source = with_rotation(
        pdfium,
        &fixture_pdf(pdfium, &[page, FixturePage { label: 2, ..page }]),
        1,
        PdfPageRenderRotation::Degrees90,
    );

    let boxes = page_sizes(pdfium, &source).unwrap();

    assert_eq!(
        boxes.iter().map(|b| b.rotation).collect::<Vec<_>>(),
        [0, 90]
    );
    let landscape = pdf_box(0.0, 0.0, 378.0, 288.0);
    assert_eq!((boxes[1].trim, boxes[1].media), (landscape, landscape));
}

#[test]
fn rejects_bytes_that_are_not_a_pdf() {
    let error = page_sizes(pdfium(), b"hello").unwrap_err();
    assert!(error.to_string().contains("not a PDF"), "{error}");
}

#[test]
fn password_protected_pdf_is_reported_as_such() {
    let encrypted = include_bytes!("data/encrypted.pdf");
    // The fixture is a sound PDF: it opens with its password.
    let unlocked = pdfium()
        .load_pdf_from_byte_slice(encrypted, Some("u"))
        .unwrap();
    assert_eq!(unlocked.pages().len(), 1);

    let error = page_sizes(pdfium(), encrypted).unwrap_err();

    assert!(matches!(error, ExportError::PasswordProtected), "{error:?}");
    assert_eq!(
        error.to_string(),
        "the PDF is password-protected; remove the password and try again"
    );
}

#[test]
fn truncated_pdf_is_not_a_pdf_or_damaged() {
    let whole = fixture_pdf(
        pdfium(),
        &[FixturePage {
            media: (0.0, 0.0, 288.0, 378.0),
            trim: None,
            bleed: None,
            label: 1,
        }],
    );

    let error = page_sizes(pdfium(), &whole[..whole.len() / 3]).unwrap_err();

    assert!(matches!(error, ExportError::NotAPdf), "{error:?}");
    assert_eq!(error.to_string(), "not a PDF or the file is damaged");
}
