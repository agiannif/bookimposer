//! Writes the app's test PDFs into the directory given as the only argument.
//! Run it with `make app-fixtures`; the app's e2e tests load the results.
//!
//! The PDFs are built by the same fixture builders the crate's tests use:
//! 288x378 pages labelled 1 to N, each with a background colour derived from
//! its label.

#[path = "../tests/support/mod.rs"]
mod support;

use pdfium_render::prelude::{PdfPageRenderRotation, Pdfium};
use std::path::PathBuf;
use support::{
    FixturePage, fixture_pdf, labelled_book, pdfium, with_rotation, with_square_annotation,
};

/// Eight labelled pages, all 288x378 except page 3, which is 300x400.
fn mixed_book(pdfium: &Pdfium) -> Vec<u8> {
    let pages: Vec<FixturePage> = (1..=8)
        .map(|label| FixturePage {
            media: if label == 3 {
                (0.0, 0.0, 300.0, 400.0)
            } else {
                (0.0, 0.0, 288.0, 378.0)
            },
            trim: None,
            bleed: None,
            label,
        })
        .collect();
    fixture_pdf(pdfium, &pages)
}

/// Eight labelled 306x396 pages whose TrimBox (9 9 297 387) is 288x378, inset 9 pt on every side.
fn trimmed_book(pdfium: &Pdfium) -> Vec<u8> {
    let pages: Vec<FixturePage> = (1..=8)
        .map(|label| FixturePage {
            media: (0.0, 0.0, 306.0, 396.0),
            trim: Some((9.0, 9.0, 297.0, 387.0)),
            bleed: None,
            label,
        })
        .collect();
    fixture_pdf(pdfium, &pages)
}

fn main() {
    let Some(dir) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: make_app_fixtures <output-dir>");
        std::process::exit(2);
    };
    let pdfium = pdfium();
    let book_8 = labelled_book(pdfium, 8);
    let fixtures = [
        ("book-8.pdf", book_8.clone()),
        ("book-74.pdf", labelled_book(pdfium, 74)),
        ("book-76.pdf", labelled_book(pdfium, 76)),
        // A printable Square annotation on page 4 (index 3).
        (
            "annotated-8.pdf",
            with_square_annotation(pdfium, &book_8, 3, true),
        ),
        // Page 2 (index 1) turned a quarter clockwise by /Rotate 90.
        (
            "rotated-8.pdf",
            with_rotation(pdfium, &book_8, 1, PdfPageRenderRotation::Degrees90),
        ),
        // Page 3 (index 2) is 300x400 among 288x378 pages, a page size mismatch.
        ("mixed-8.pdf", mixed_book(pdfium)),
        // 306x396 pages with a TrimBox inset 9 pt on every side.
        ("trimmed-8.pdf", trimmed_book(pdfium)),
    ];
    for (name, bytes) in fixtures {
        let path = dir.join(name);
        if let Err(error) = std::fs::write(&path, bytes) {
            eprintln!("could not write {}: {error}", path.display());
            std::process::exit(1);
        }
        println!("wrote {}", path.display());
    }
}
