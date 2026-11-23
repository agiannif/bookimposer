//! Writes a book whose pages all share one image, one form XObject and one
//! font, for measuring export size and time on books like typeset ones,
//! where many pages draw the same resources. Run it with
//! `make export-size-probe`, which also exports the book and reports sizes.
//!
//! Usage: shared_resource_book PAGES OUT.pdf

#[path = "../tests/support/mod.rs"]
mod support;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [pages, out] = args.as_slice() else {
        eprintln!("usage: shared_resource_book PAGES OUT.pdf");
        std::process::exit(2);
    };
    let Ok(pages) = pages.parse::<u32>() else {
        eprintln!("shared_resource_book: PAGES must be a whole number, got {pages:?}");
        std::process::exit(2);
    };
    if let Err(error) = std::fs::write(out, support::shared_resource_book(pages, |_| 0)) {
        eprintln!("shared_resource_book: cannot write {out}: {error}");
        std::process::exit(1);
    }
}
