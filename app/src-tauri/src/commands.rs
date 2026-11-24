//! The app's Tauri commands, thin wrappers over the pdf-export crate.
//!
//! PDF bytes cross the IPC bridge raw, never as JSON number arrays:
//!
//! - `page_sizes`: the request body is the raw PDF. The answer is the same
//!   JSON as `bookimposer-export page-sizes`: `{ pageSizes, boxes }`.
//! - `export_pdf`: the request body is a frame of a 4-byte big-endian length
//!   N, then N bytes of UTF-8 JSON `{ "layout": <Layout JSON as a string>,
//!   "cutMarks": bool, "foldMarks": bool }`, then the raw source PDF to the
//!   end. The answer is raw bytes framed the same way: a 4-byte big-endian
//!   length M, M bytes of the warnings as a UTF-8 JSON array of strings,
//!   then the sheets PDF to the end.
//!
//! `app/src/lib/backend-tauri.ts` (framing in `ipc-frame.ts`) is the other
//! end of this format; golden frames in `tests/data/` hold both ends to it
//! (`make ipc-fixtures` regenerates them). Errors
//! come back as the exporter's message string.
//!
//! The logic lives in plain functions so tests can run it without a window.

use pdf_export::pdfium::{self, Pdfium};
use pdf_export::{ExportError, ExportOptions, ExportOutput, export, layout};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;
use tauri::ipc::{InvokeBody, Request, Response};

/// Where PDFium is loaded from when `$BOOKIMPOSER_PDFIUM_DIR` is unset: the
/// app's bundled `resources/pdfium/`.
pub struct PdfiumFallbackDir(pub PathBuf);

/// The bundled PDFium's folder inside the app's resource directory, where
/// `tauri.conf.json` bundles `resources/pdfium/*`.
pub fn bundled_pdfium_dir(resource_dir: &Path) -> PathBuf {
    resource_dir.join("resources/pdfium")
}

/// The process's one PDFium binding, loaded on first use from
/// `$BOOKIMPOSER_PDFIUM_DIR`, or from `fallback_dir` when that is unset. A
/// failed load is not remembered, so the next call tries again.
pub fn shared_pdfium(fallback_dir: &Path) -> Result<&'static Pdfium, String> {
    static PDFIUM: Mutex<Option<&'static Pdfium>> = Mutex::new(None);
    let mut slot = PDFIUM
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(pdfium) = *slot {
        return Ok(pdfium);
    }
    let loaded = pdfium::load_with_default(fallback_dir)
        .map_err(|error| ExportError::from(error).to_string())?;
    // Leaked on purpose: PDFium binds once per process and lives as long as it.
    let pdfium: &'static Pdfium = Box::leak(Box::new(loaded));
    *slot = Some(pdfium);
    Ok(pdfium)
}

/// The page-sizes report for the PDF in `pdf`.
pub fn page_sizes_json(pdfium: &Pdfium, pdf: &[u8]) -> Result<serde_json::Value, String> {
    let boxes = pdf_export::page_sizes(pdfium, pdf).map_err(|error| error.to_string())?;
    Ok(pdf_export::page_sizes_json(&boxes))
}

/// Imposes the PDF in `pdf` onto sheets as the Layout in `layout_json` places
/// its pages.
pub fn export_bytes(
    pdfium: &Pdfium,
    pdf: &[u8],
    layout_json: &str,
    options: ExportOptions,
) -> Result<ExportOutput, String> {
    let layout = layout::parse(layout_json).map_err(|error| error.to_string())?;
    export(pdfium, pdf, &layout, &options).map_err(|error| error.to_string())
}

/// The JSON header of an `export_pdf` request.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportRequest {
    /// The Layout as JSON text.
    pub layout: String,
    pub cut_marks: bool,
    pub fold_marks: bool,
}

impl ExportRequest {
    pub fn options(&self) -> ExportOptions {
        ExportOptions {
            cut_marks: self.cut_marks,
            fold_marks: self.fold_marks,
        }
    }
}

/// Splits an `export_pdf` request body into its header and the PDF bytes.
pub fn read_export_request(body: &[u8]) -> Result<(ExportRequest, &[u8]), String> {
    let (length, rest) = body
        .split_first_chunk::<4>()
        .ok_or("export request is shorter than its length prefix")?;
    let length = u32::from_be_bytes(*length) as usize;
    if rest.len() < length {
        return Err("export request is shorter than its header length".to_string());
    }
    let (header, pdf) = rest.split_at(length);
    let request = serde_json::from_slice(header)
        .map_err(|error| format!("export request header is not valid: {error}"))?;
    Ok((request, pdf))
}

/// The `export_pdf` answer body for `output`.
pub fn export_response(output: &ExportOutput) -> Vec<u8> {
    let warnings = serde_json::to_vec(&output.warnings).expect("strings serialize to JSON");
    let length = u32::try_from(warnings.len()).expect("warnings fit in 4 GiB");
    let mut body = Vec::with_capacity(4 + warnings.len() + output.pdf.len());
    body.extend_from_slice(&length.to_be_bytes());
    body.extend_from_slice(&warnings);
    body.extend_from_slice(&output.pdf);
    body
}

/// The raw bytes of `request`'s body.
fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("expected raw bytes, not JSON, in the request body".to_string()),
    }
}

// Async so the PDF work runs off the main thread and the window stays live.
#[tauri::command]
pub async fn page_sizes(
    request: Request<'_>,
    fallback_dir: State<'_, PdfiumFallbackDir>,
) -> Result<serde_json::Value, String> {
    page_sizes_json(shared_pdfium(&fallback_dir.0)?, raw_body(&request)?)
}

#[tauri::command]
pub async fn export_pdf(
    request: Request<'_>,
    fallback_dir: State<'_, PdfiumFallbackDir>,
) -> Result<Response, String> {
    let (header, pdf) = read_export_request(raw_body(&request)?)?;
    let output = export_bytes(
        shared_pdfium(&fallback_dir.0)?,
        pdf,
        &header.layout,
        header.options(),
    )?;
    Ok(Response::new(export_response(&output)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn repo_file(path: &str) -> Vec<u8> {
        let full = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .join(path);
        std::fs::read(&full).unwrap_or_else(|e| panic!("cannot read {}: {e}", full.display()))
    }

    fn book_8() -> Vec<u8> {
        repo_file("app/e2e/fixtures/book-8.pdf")
    }

    fn layout(name: &str) -> String {
        String::from_utf8(repo_file(&format!("crates/pdf-export/tests/data/{name}"))).unwrap()
    }

    /// PDFium from `$BOOKIMPOSER_PDFIUM_DIR`, which the Makefile sets.
    fn pdfium() -> &'static Pdfium {
        shared_pdfium(Path::new("/nonexistent"))
            .expect("could not load PDFium; run `make fetch-pdfium`")
    }

    fn no_marks() -> ExportOptions {
        ExportOptions::default()
    }

    /// An export request body as backend-tauri.ts frames it.
    fn framed_request(header: &str, pdf: &[u8]) -> Vec<u8> {
        let mut body = (header.len() as u32).to_be_bytes().to_vec();
        body.extend_from_slice(header.as_bytes());
        body.extend_from_slice(pdf);
        body
    }

    #[test]
    fn the_bundle_puts_the_pdfium_resources_where_the_app_looks_for_them() {
        // Tauri copies each bundle resource to its own path relative to src-tauri, under the
        // resource directory (Contents/Resources in a macOS .app). The README stands in for
        // the library, which only release builds put next to it.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let patterns: Vec<String> =
            serde_json::from_value(config["bundle"]["resources"].clone()).unwrap();
        let readme = tauri::utils::resources::ResourcePaths::new(&patterns, true)
            .iter()
            .map(Result::unwrap)
            .find(|resource| resource.path().ends_with("resources/pdfium/README.md"))
            .expect("tauri.conf.json does not bundle resources/pdfium/");
        let resource_dir = Path::new("/Applications/bookimposer.app/Contents/Resources");
        assert_eq!(
            resource_dir.join(readme.target()),
            bundled_pdfium_dir(resource_dir).join("README.md")
        );
    }

    #[test]
    fn shared_pdfium_binds_once_and_hands_out_the_same_binding() {
        assert!(std::ptr::eq(pdfium(), pdfium()));
    }

    #[test]
    fn page_sizes_reports_every_page_of_the_8_page_book() {
        let report = page_sizes_json(pdfium(), &book_8()).unwrap();
        let sizes = report["pageSizes"].as_array().unwrap();
        assert_eq!(sizes.len(), 8);
        assert_eq!(
            sizes[0],
            serde_json::json!({"width": 288.0, "height": 378.0})
        );
        assert_eq!(report["boxes"].as_array().unwrap().len(), 8);
    }

    #[test]
    fn page_sizes_of_a_non_pdf_is_the_exporters_error() {
        let error = page_sizes_json(pdfium(), b"not a pdf").unwrap_err();
        assert_eq!(error, "not a PDF or the file is damaged");
    }

    #[test]
    fn export_with_a_layout_that_has_errors_is_the_exporters_error() {
        let error = export_bytes(
            pdfium(),
            &book_8(),
            &layout("nan-sheet.layout.json"),
            no_marks(),
        )
        .unwrap_err();
        assert!(
            error.starts_with("the layout has errors; fix the book settings and impose again: "),
            "{error}"
        );
    }

    #[test]
    fn export_with_unparsable_layout_json_is_the_parsers_error() {
        let error = export_bytes(pdfium(), &book_8(), "{", no_marks()).unwrap_err();
        let expected = pdf_export::layout::parse("{").unwrap_err().to_string();
        assert_eq!(error, expected);
    }

    #[test]
    fn export_imposes_the_book_onto_a_pdf() {
        let options = ExportOptions {
            cut_marks: true,
            fold_marks: true,
        };
        let output = export_bytes(
            pdfium(),
            &book_8(),
            &layout("full-bleed-sheet.layout.json"),
            options,
        )
        .unwrap();
        assert!(output.pdf.starts_with(b"%PDF-"));
        let sheets = pdfium()
            .load_pdf_from_byte_slice(&output.pdf, None)
            .unwrap();
        // One sheet, front and back.
        assert_eq!(sheets.pages().len(), 2);
    }

    #[test]
    fn export_request_splits_into_header_and_pdf_bytes() {
        let header = r#"{"layout":"{\"sheets\":[]}","cutMarks":true,"foldMarks":false}"#;
        let body = framed_request(header, b"%PDF-1.7 bytes");
        let (request, pdf) = read_export_request(&body).unwrap();
        assert_eq!(request.layout, r#"{"sheets":[]}"#);
        assert_eq!(
            request.options(),
            ExportOptions {
                cut_marks: true,
                fold_marks: false
            }
        );
        assert_eq!(pdf, b"%PDF-1.7 bytes");
    }

    #[test]
    fn export_request_shorter_than_its_length_prefix_is_an_error() {
        assert!(read_export_request(&[0, 0]).is_err());
        let mut body = framed_request(r#"{"layout":"","cutMarks":false,"foldMarks":false}"#, b"");
        body.truncate(body.len() - 1);
        assert!(read_export_request(&body).is_err());
    }

    #[test]
    fn export_request_with_a_malformed_header_is_an_error() {
        let error = read_export_request(&framed_request(r#"{"layout":1}"#, b"")).unwrap_err();
        assert!(
            error.starts_with("export request header is not valid: "),
            "{error}"
        );
    }

    #[test]
    fn export_response_frames_warnings_before_the_pdf() {
        let output = ExportOutput {
            pdf: b"%PDF-1.7".to_vec(),
            warnings: vec!["page 3 has annotations".to_string()],
        };
        let body = export_response(&output);
        let warnings = br#"["page 3 has annotations"]"#;
        assert_eq!(body[..4], (warnings.len() as u32).to_be_bytes());
        assert_eq!(&body[4..4 + warnings.len()], warnings);
        assert_eq!(&body[4 + warnings.len()..], b"%PDF-1.7");
    }

    // The golden frames in tests/data/ are shared with app/test/ipc-frame.test.ts, which encodes
    // the request and decodes the answer; the payloads here repeat app/test/ipc-fixtures.ts.
    // `make ipc-fixtures` regenerates the files.

    #[test]
    fn golden_export_request_from_the_frontend_reads_back() {
        let body = repo_file("app/src-tauri/tests/data/export-request.bin");
        let (request, pdf) = read_export_request(&body).unwrap();
        assert_eq!(request.layout, r#"{"sheets":[]}"#);
        assert_eq!(
            request.options(),
            ExportOptions {
                cut_marks: true,
                fold_marks: false
            }
        );
        assert_eq!(pdf, b"%PDF-1.7 source");
    }

    #[test]
    fn export_response_byte_equals_the_golden_answer_the_frontend_reads() {
        let output = ExportOutput {
            pdf: b"%PDF-1.7 sheets".to_vec(),
            warnings: vec!["page 3 has annotations".to_string(), "café 📖".to_string()],
        };
        assert_eq!(
            export_response(&output),
            repo_file("app/src-tauri/tests/data/export-response.bin")
        );
    }
}
