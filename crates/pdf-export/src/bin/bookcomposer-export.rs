//! Command line front end for the PDF exporter.

use pdf_export::{
    ExportError, ExportOptions, export, layout, page_sizes, page_sizes_json, pdfium, timing,
};
use std::process::ExitCode;

const USAGE: &str = "\
Usage: bookcomposer-export <command>

Commands:
  page-sizes <input.pdf>   Print each page's trim size as it displays (after
                           /Rotate), and its stored boxes and /Rotate, as JSON
  export --layout <layout.json> --input <source.pdf> --output <sheets.pdf>
         [--cut-marks] [--fold-marks]
                           Impose the source pages onto sheets as the layout
                           (from engine/bin/impose.ts) places them; the flags
                           draw the layout's cut and fold marks on both sides
                           of each sheet. Warnings go to stderr.

PDFium is loaded from $BOOKCOMPOSER_PDFIUM_DIR.";

fn main() -> ExitCode {
    timing::stage("cli.total", run)
}

fn run() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        ["page-sizes", input] => print_page_sizes(input),
        ["export", ref flags @ ..] => match export_args(flags) {
            Some(args) => write_sheets(&args),
            None => Err(USAGE.to_string()),
        },
        _ => Err(USAGE.to_string()),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

/// The `export` command's arguments.
struct ExportArgs<'a> {
    layout: &'a str,
    input: &'a str,
    output: &'a str,
    options: ExportOptions,
}

/// The `export` flags: `--layout`, `--input` and `--output` with values, in
/// any order, each given once, and the optional `--cut-marks` and
/// `--fold-marks`; `None` when a required one is missing or any is repeated
/// or unknown.
fn export_args<'a>(flags: &[&'a str]) -> Option<ExportArgs<'a>> {
    let (mut layout, mut input, mut output) = (None, None, None);
    let mut options = ExportOptions::default();
    let mut flags = flags.iter().copied();
    while let Some(flag) = flags.next() {
        let slot = match flag {
            "--layout" => &mut layout,
            "--input" => &mut input,
            "--output" => &mut output,
            "--cut-marks" if !options.cut_marks => {
                options.cut_marks = true;
                continue;
            }
            "--fold-marks" if !options.fold_marks => {
                options.fold_marks = true;
                continue;
            }
            _ => return None,
        };
        if slot.is_some() {
            return None;
        }
        *slot = Some(flags.next()?);
    }
    Some(ExportArgs {
        layout: layout?,
        input: input?,
        output: output?,
        options,
    })
}

fn write_sheets(args: &ExportArgs) -> Result<(), String> {
    let layout_json = timing::stage("cli.read_layout", || std::fs::read_to_string(args.layout))
        .map_err(|error| {
            ExportError::CannotRead(format!("{}: {error}", args.layout)).to_string()
        })?;
    let layout = timing::stage("cli.parse_layout", || layout::parse(&layout_json))
        .map_err(|error| error.to_string())?;
    let source = read(args.input)?;
    let pdfium = load_pdfium()?;
    let exported = export(&pdfium, &source, &layout, &args.options)
        .map_err(|error| describe(args.input, error))?;
    for warning in &exported.warnings {
        eprintln!("warning: {warning}");
    }
    timing::stage("cli.write_output", || {
        std::fs::write(args.output, &exported.pdf)
    })
    .map_err(|error| format!("cannot write {}: {error}", args.output))
}

/// The message for `error`, naming the `input` PDF when it is the problem.
fn describe(input: &str, error: ExportError) -> String {
    match error {
        ExportError::NotAPdf | ExportError::PasswordProtected => format!("{input}: {error}"),
        other => other.to_string(),
    }
}

fn load_pdfium() -> Result<pdfium::Pdfium, String> {
    timing::stage("cli.pdfium_bind", pdfium::load)
        .map_err(|error| ExportError::from(error).to_string())
}

fn read(path: &str) -> Result<Vec<u8>, String> {
    timing::stage("cli.read_input", || std::fs::read(path))
        .map_err(|error| ExportError::CannotRead(format!("{path}: {error}")).to_string())
}

fn print_page_sizes(input: &str) -> Result<(), String> {
    let source = read(input)?;
    let pdfium = load_pdfium()?;
    let boxes = page_sizes(&pdfium, &source).map_err(|error| describe(input, error))?;
    println!(
        "{}",
        timing::stage("cli.page_sizes_json", || page_sizes_json(&boxes))
    );
    Ok(())
}
