//! The Layout JSON contract: what the engine CLI prints, the exporter reads.

use pdf_export::layout::{self, Layout};

const WORKED_EXAMPLE: &str = include_str!("data/worked-example.layout.json");

#[test]
fn parses_the_engine_worked_example() {
    let layout: Layout = layout::parse(WORKED_EXAMPLE).unwrap();
    assert_eq!(layout.sheet.width, 612.0);
    assert_eq!(layout.sheet.height, 792.0);
    assert_eq!(layout.sheets.len(), 10);
    assert_eq!(layout.fillers.count, 2);
    assert!(layout.issues.is_empty());
    let first = &layout.sheets[0].front.placements[0];
    assert_eq!(first.pdf_page, Some(9));
    assert_eq!(first.panel.width, 288.0);
    assert_eq!(first.rotation, 0);
    assert!(layout.sheets[9].back.placements.is_empty());
    assert_eq!(layout.sheets[0].fold_lines.len(), 2);
}

#[test]
fn round_trips_through_serde() {
    let layout = layout::parse(WORKED_EXAMPLE).unwrap();
    let again = layout::parse(&serde_json::to_string(&layout).unwrap()).unwrap();
    assert_eq!(layout, again);
}

#[test]
fn parses_a_blank_panel_and_issue_data() {
    let json = WORKED_EXAMPLE.replacen("\"pdfPage\":9", "\"pdfPage\":null", 1);
    let layout = layout::parse(&json).unwrap();
    assert_eq!(layout.sheets[0].front.placements[0].pdf_page, None);

    let json = r#"{"sheet":{"width":1,"height":1},"sheets":[],"allocations":[],"body":null,
        "perSheet":[],"fillers":{"count":0,"size":{"width":0,"height":0}},
        "issues":[{"code":"piece-does-not-fit","severity":"error","message":"m","data":{"width":3}}]}"#;
    let layout = layout::parse(json).unwrap();
    assert_eq!(layout.issues[0].data.as_ref().unwrap()["width"], 3);
}

#[test]
fn rejects_a_rotation_that_is_not_a_right_angle() {
    let json = WORKED_EXAMPLE.replacen("\"rotation\":0", "\"rotation\":45", 1);
    let err = layout::parse(&json).unwrap_err().to_string();
    assert!(err.contains("rotation"), "{err}");
    assert!(err.contains("45"), "{err}");
}

#[test]
fn rejects_an_unknown_field_by_name() {
    let json = WORKED_EXAMPLE.replacen('{', "{\"bogusField\":1,", 1);
    let err = layout::parse(&json).unwrap_err().to_string();
    assert!(err.contains("bogusField"), "{err}");
}

#[test]
fn parses_the_cli_error_layout_for_a_nan_sheet() {
    // The engine prints this for a spec whose sheet width is NaN.
    let json = include_str!("data/nan-sheet.layout.json");
    let layout = layout::parse(json).unwrap();
    assert_eq!(layout.sheet.width, 0.0);
    assert_eq!(layout.sheet.height, 0.0);
    assert!(layout.sheets.is_empty());
    assert_eq!(layout.issues[0].code, "invalid-print-settings");
    assert_eq!(layout.issues[0].severity, "error");
}
