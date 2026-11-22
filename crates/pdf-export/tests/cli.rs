//! The `bookcomposer-export` binary's command line.

mod support;

use pdf_export::geometry::to_pdf_rect;
use pdf_export::layout::{self, Rect};
use pdf_export::marks::mark_segments;
use pdfium_render::prelude::PdfPageRenderRotation;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use support::{
    FixturePage, assert_images_match, book_pdf, crop_region, fixture_pdf, pdfium, render, turned,
    with_crop, with_rotation,
};

fn run(args: &[&Path]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bookcomposer-export"))
        .args(args)
        .output()
        .unwrap()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn page_sizes_prints_trim_sizes_and_boxes_as_json() {
    let page = |media, trim| FixturePage {
        media,
        trim,
        bleed: None,
        label: 1,
    };
    let plain = (0.0, 0.0, 288.0, 378.0);
    let source = fixture_pdf(
        pdfium(),
        &[
            page((0.0, 0.0, 306.0, 396.0), Some((9.0, 9.0, 297.0, 387.0))),
            page(plain, None),
            page(plain, None),
        ],
    );
    let dir = std::env::temp_dir().join(format!("bookcomposer-cli-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("source.pdf");
    std::fs::write(&input, source).unwrap();

    let output = run(&[Path::new("page-sizes"), &input]);
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    let printed: Value = serde_json::from_slice(&output.stdout).unwrap();
    let size = json!({"width": 288.0, "height": 378.0});
    assert_eq!(printed["pageSizes"], json!([size, size, size]));
    assert_eq!(
        printed["boxes"][0],
        json!({
            "trim": {"left": 9.0, "bottom": 9.0, "width": 288.0, "height": 378.0},
            "crop": {"left": 0.0, "bottom": 0.0, "width": 306.0, "height": 396.0},
            "media": {"left": 0.0, "bottom": 0.0, "width": 306.0, "height": 396.0},
            "bleed": null,
            "rotation": 0,
        })
    );
}

#[test]
fn page_sizes_reports_rotated_pages_as_they_display() {
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
    let dir = std::env::temp_dir().join(format!("bookcomposer-cli-rot-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("source.pdf");
    std::fs::write(&input, source).unwrap();

    let output = run(&[Path::new("page-sizes"), &input]);
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    let printed: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        printed["pageSizes"],
        json!([{"width": 288.0, "height": 378.0}])
    );
    assert_eq!(printed["boxes"][0]["rotation"], json!(90));
    assert_eq!(
        printed["boxes"][0]["trim"],
        json!({"left": 0.0, "bottom": 0.0, "width": 378.0, "height": 288.0})
    );
}

#[test]
fn input_that_is_not_a_pdf_exits_2() {
    let dir = std::env::temp_dir().join(format!("bookcomposer-cli-text-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("notes.txt");
    std::fs::write(&input, "hello").unwrap();

    let output = run(&[Path::new("page-sizes"), &input]);
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("not a PDF"), "{}", stderr(&output));
}

#[test]
fn password_protected_input_names_the_file_and_exits_2() {
    let dir = std::env::temp_dir().join(format!("bookcomposer-cli-enc-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("locked.pdf");
    std::fs::write(&input, include_bytes!("data/encrypted.pdf")).unwrap();

    let sizes = run(&[Path::new("page-sizes"), &input]);
    let layout = dir.join("layout.json");
    std::fs::write(&layout, worked_example().to_string()).unwrap();
    let sheets = dir.join("sheets.pdf");
    let export = run(&[
        Path::new("export"),
        Path::new("--layout"),
        &layout,
        Path::new("--input"),
        &input,
        Path::new("--output"),
        &sheets,
    ]);
    std::fs::remove_dir_all(&dir).unwrap();

    let expected = format!(
        "{}: the PDF is password-protected; remove the password and try again\n",
        input.display()
    );
    for output in [sizes, export] {
        assert_eq!(output.status.code(), Some(2));
        assert_eq!(stderr(&output), expected);
    }
}

#[test]
fn damaged_input_names_the_file_and_exits_2() {
    let dir = std::env::temp_dir().join(format!("bookcomposer-cli-cut-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("cut.pdf");
    let whole = book_pdf(pdfium());
    std::fs::write(&input, &whole[..whole.len() / 3]).unwrap();

    let output = run(&[Path::new("page-sizes"), &input]);
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        stderr(&output),
        format!("{}: not a PDF or the file is damaged\n", input.display())
    );
}

#[test]
fn missing_file_exits_2() {
    let output = run(&[Path::new("page-sizes"), Path::new("/nonexistent/in.pdf")]);

    assert_eq!(output.status.code(), Some(2));
    assert!(
        stderr(&output).contains("cannot read"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn unknown_subcommand_prints_usage_and_exits_2() {
    let output = run(&[Path::new("frobnicate")]);

    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("Usage"), "{}", stderr(&output));
}

#[test]
fn help_prints_usage_to_stderr() {
    let output = run(&[Path::new("--help")]);

    assert!(
        stderr(&output).contains("page-sizes"),
        "{}",
        stderr(&output)
    );
}

/// Writes the worked-example layout with `issues` and its 76-page source to
/// a fresh temp dir, runs `export` on them and returns the output and the
/// exported PDF, if one was written.
fn run_export(name: &str, issues: Value) -> (Output, Option<Vec<u8>>) {
    let mut layout = worked_example();
    layout["issues"] = issues;
    run_export_of(name, &layout, &[])
}

fn worked_example() -> Value {
    serde_json::from_str(include_str!("data/worked-example.layout.json")).unwrap()
}

/// Like [`run_export`] for `layout`, with `flags` added to the command line.
fn run_export_of(name: &str, layout: &Value, flags: &[&str]) -> (Output, Option<Vec<u8>>) {
    let dir = std::env::temp_dir().join(format!("bookcomposer-cli-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let (layout_path, input, sheets) = (
        dir.join("layout.json"),
        dir.join("source.pdf"),
        dir.join("sheets.pdf"),
    );
    std::fs::write(&layout_path, layout.to_string()).unwrap();
    std::fs::write(&input, book_pdf(pdfium())).unwrap();

    let mut args = vec![
        Path::new("export"),
        Path::new("--layout"),
        &layout_path,
        Path::new("--input"),
        &input,
        Path::new("--output"),
        &sheets,
    ];
    args.extend(flags.iter().map(Path::new));
    let output = run(&args);
    let pdf = std::fs::read(&sheets).ok();
    std::fs::remove_dir_all(&dir).unwrap();
    (output, pdf)
}

#[test]
fn export_writes_the_sheets_pdf() {
    let (output, pdf) = run_export("export", json!([]));

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stderr(&output), "");
    let pdf = pdf.unwrap();
    let document = pdfium().load_pdf_from_byte_slice(&pdf, None).unwrap();
    assert_eq!(document.pages().len(), 20);
}

#[test]
fn export_of_a_layout_with_errors_exits_2() {
    let issue = json!({
        "code": "piece-does-not-fit",
        "severity": "error",
        "message": "a piece does not fit on the sheet",
        "data": null,
    });
    let (output, pdf) = run_export("export-error", json!([issue]));

    assert_eq!(output.status.code(), Some(2));
    assert!(
        stderr(&output).contains("a piece does not fit on the sheet"),
        "{}",
        stderr(&output)
    );
    assert!(pdf.is_none(), "an output file was written");
}

#[test]
fn export_without_its_flags_prints_usage_and_exits_2() {
    let output = run(&[Path::new("export"), Path::new("--layout")]);

    assert_eq!(output.status.code(), Some(2));
    assert!(stderr(&output).contains("Usage"), "{}", stderr(&output));
}

#[test]
fn export_draws_marks_when_asked() {
    let (plain, plain_pdf) = run_export_of("marks-off", &worked_example(), &[]);
    let (marked, marked_pdf) = run_export_of(
        "marks-on",
        &worked_example(),
        &["--cut-marks", "--fold-marks"],
    );

    assert!(plain.status.success() && marked.status.success());
    assert_eq!(stderr(&marked), "");
    let (plain_pdf, marked_pdf) = (plain_pdf.unwrap(), marked_pdf.unwrap());
    let top_left_tick = |pdf: &[u8]| render(pdfium(), pdf, 0, 4.0).get_pixel(40, 72).0[0];
    assert_eq!(top_left_tick(&plain_pdf), 255);
    assert!(top_left_tick(&marked_pdf) < 200);
}

#[test]
fn export_warns_on_stderr_when_a_sheet_has_no_room_for_marks() {
    let mut layout = worked_example();
    layout["sheets"][0]["foldLines"] = json!([]);
    layout["sheets"][0]["cutLines"] = json!([{"x1": 0, "y1": 0, "x2": 612, "y2": 0}]);
    let (output, pdf) = run_export_of("marks-no-room", &layout, &["--cut-marks"]);

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(
        stderr(&output),
        "warning: cut/fold marks would overlap page content on sheet 1\n"
    );
    assert!(pdf.is_some());
}

/// The repository's `scripts/impose-pdf`, run end to end on the 76-page book
/// with 9 signatures and boards, checked against its own layout.
#[test]
fn impose_pdf_script_exports_the_worked_example() {
    const PX_PER_PT: f32 = 4.0;
    let dir = temp_dir("e2e");
    let (input, sheets, kept) = (
        dir.join("book.pdf"),
        dir.join("sheets.pdf"),
        dir.join("kept"),
    );
    let source = book_pdf(pdfium());
    std::fs::write(&input, &source).unwrap();

    let output = Command::new(repo().join("scripts/impose-pdf"))
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&sheets)
        .args(["--signatures", "9", "--front-board", "--back-board"])
        .args([
            "--sheet",
            "letter",
            "--margin",
            "18",
            "--cut-marks",
            "--keep-temp",
        ])
        .arg(&kept)
        .output()
        .unwrap();
    let exported = std::fs::read(&sheets);
    let layout_json = std::fs::read_to_string(kept.join("layout.json"));
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    let (exported, layout) = (
        exported.unwrap(),
        layout::parse(&layout_json.unwrap()).unwrap(),
    );
    let document = pdfium().load_pdf_from_byte_slice(&exported, None).unwrap();
    assert_eq!(document.pages().len(), 20);

    let rendered = render(pdfium(), &exported, 0, PX_PER_PT);
    for placement in &layout.sheets[0].front.placements {
        let pdf_page = placement.pdf_page.unwrap();
        let alone = render(pdfium(), &source, pdf_page as u16, PX_PER_PT);
        assert_images_match(
            &crop_region(
                &rendered,
                layout.sheet.height as f32,
                &to_pdf_rect(&placement.content, &layout.sheet),
                PX_PER_PT,
            ),
            &turned(&alone, placement.rotation),
            &format!("source page {pdf_page}"),
        );
    }
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// A fresh, empty temp dir for one test.
fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("bookcomposer-cli-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A dir holding a `cargo` that appends its arguments, one line per call, to
/// `cargo-calls.txt` beside it, then runs the real cargo with them.
fn recording_cargo(dir: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let shim = bin.join("cargo");
    std::fs::write(
        &shim,
        format!(
            "#!/usr/bin/env bash\necho \"$*\" >> {}\nexec {} \"$@\"\n",
            dir.join("cargo-calls.txt").display(),
            env!("CARGO")
        ),
    )
    .unwrap();
    std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn cargo_calls(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join("cargo-calls.txt")).ok()
}

/// 16 pages of 288x378 trim with a 9 pt bleed all round.
fn bleed_book() -> Vec<u8> {
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
fn impose_pdf_rejects_bad_flags_before_building_or_reading_the_pdf() {
    let dir = temp_dir("e2e-bad-flags");
    let input = dir.join("book.pdf");
    std::fs::write(&input, bleed_book()).unwrap();

    let output = Command::new(repo().join("scripts/impose-pdf"))
        .env("RUSTUP_BIN", recording_cargo(&dir))
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(dir.join("sheets.pdf"))
        .args(["--signatures", "0"])
        .output()
        .unwrap();
    let calls = cargo_calls(&dir);
    std::fs::remove_dir_all(&dir).unwrap();

    assert_eq!(output.status.code(), Some(1));
    let stderr = stderr(&output);
    assert!(stderr.contains("--signatures"), "{stderr}");
    assert!(!stderr.contains("intermediate files"), "{stderr}");
    assert_eq!(calls, None, "cargo ran before the flags were checked");
}

#[test]
fn impose_pdf_always_rebuilds_the_export_binary() {
    let dir = temp_dir("e2e-rebuild");
    let (input, sheets) = (dir.join("book.pdf"), dir.join("sheets.pdf"));
    std::fs::write(&input, bleed_book()).unwrap();
    let run = || {
        Command::new(repo().join("scripts/impose-pdf"))
            .env("RUSTUP_BIN", recording_cargo(&dir))
            .arg("--input")
            .arg(&input)
            .arg("--output")
            .arg(&sheets)
            .args(["--signatures", "1", "--folds", "2", "--sheet", "1300x850"])
            .output()
            .unwrap()
    };

    // The first run leaves an up-to-date binary; the second must still call cargo.
    let (first, second) = (run(), run());
    let calls = cargo_calls(&dir);
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(first.status.success(), "{}", stderr(&first));
    assert!(second.status.success(), "{}", stderr(&second));
    let calls = calls.unwrap_or_default();
    let builds: Vec<&str> = calls.lines().collect();
    assert_eq!(builds.len(), 2, "{calls}");
    for build in builds {
        assert!(
            build.starts_with("build --release -p pdf-export"),
            "{build}"
        );
    }
}

/// `scripts/impose-pdf` end to end with bleed, a gap, two folds, short-edge
/// duplex and both kinds of marks, checked against its own layout.
#[test]
fn impose_pdf_exports_a_bleed_book_with_marks() {
    const PX_PER_PT: f32 = 4.0;
    let dir = temp_dir("e2e-bleed");
    let (input, sheets, kept) = (
        dir.join("book.pdf"),
        dir.join("sheets.pdf"),
        dir.join("kept"),
    );
    let source = bleed_book();
    std::fs::write(&input, &source).unwrap();

    let output = Command::new(repo().join("scripts/impose-pdf"))
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&sheets)
        .args([
            "--signatures",
            "1",
            "--folds",
            "2",
            "--bleed",
            "9",
            "--gap",
            "18",
        ])
        .args([
            "--duplex",
            "short-edge",
            "--sheet",
            "1300x850",
            "--margin",
            "18",
        ])
        .args(["--cut-marks", "--fold-marks", "--keep-temp"])
        .arg(&kept)
        .output()
        .unwrap();
    let exported = std::fs::read(&sheets);
    let layout_json = std::fs::read_to_string(kept.join("layout.json"));
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(stderr(&output), "");
    let (exported, layout) = (
        exported.unwrap(),
        layout::parse(&layout_json.unwrap()).unwrap(),
    );
    let sheet = &layout.sheets[0];
    let height = layout.sheet.height as f32;

    for (output_page, side) in [(0, &sheet.front), (1, &sheet.back)] {
        let rendered = render(pdfium(), &exported, output_page, PX_PER_PT);
        for placement in &side.placements {
            let pdf_page = placement.pdf_page.unwrap();
            // The source page's trim, as PDFium renders the page cropped to it.
            let alone = with_crop(pdfium(), &source, pdf_page as u16, (9.0, 9.0, 297.0, 387.0));
            assert_images_match(
                &crop_region(
                    &rendered,
                    height,
                    &to_pdf_rect(&placement.content, &layout.sheet),
                    PX_PER_PT,
                ),
                &turned(
                    &render(pdfium(), &alone, pdf_page as u16, PX_PER_PT),
                    placement.rotation,
                ),
                &format!("output page {output_page}, source page {pdf_page}"),
            );
        }
    }

    // The first cut line's first tick, which lies outside every clip, is dark.
    let clips: Vec<Rect> = sheet.front.placements.iter().map(|p| p.clip).collect();
    let tick = mark_segments(&sheet.cut_lines[0], &clips, &layout.sheet)[0];
    let front = render(pdfium(), &exported, 0, PX_PER_PT);
    let px = |pt: f64| (pt * f64::from(PX_PER_PT)) as u32;
    let (x, y) = (px((tick.x1 + tick.x2) / 2.0), px((tick.y1 + tick.y2) / 2.0));
    let darkest = (y - 1..=y)
        .flat_map(|y| (x - 1..=x).map(move |x| (x, y)))
        .map(|(x, y)| front.get_pixel(x, y).0[0])
        .min()
        .unwrap();
    assert!(darkest < 200, "no tick at {tick:?}: {darkest}");
}
