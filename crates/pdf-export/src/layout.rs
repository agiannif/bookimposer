//! The Layout JSON the engine CLI prints (`engine/src/types.ts`). Units are
//! PDF points, origin top-left, y down, per side.

use serde::{Deserialize, Deserializer, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// One page on one side of a sheet. `pdf_page` None is a blank panel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PagePlacement {
    pub pdf_page: Option<usize>,
    pub part_index: usize,
    pub panel: Rect,
    pub content: Rect,
    pub clip: Rect,
    /// Degrees clockwise as seen on that side: 0, 90, 180 or 270.
    #[serde(deserialize_with = "right_angle")]
    pub rotation: u16,
}

fn right_angle<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u16, D::Error> {
    let degrees = u16::deserialize(deserializer)?;
    match degrees {
        0 | 90 | 180 | 270 => Ok(degrees),
        _ => Err(serde::de::Error::custom(format!(
            "invalid rotation {degrees}, expected 0, 90, 180 or 270"
        ))),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetLine {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FoldLine {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub opens_by_trim: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetSide {
    pub placements: Vec<PagePlacement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sheet {
    pub front: SheetSide,
    pub back: SheetSide,
    pub cut_lines: Vec<SheetLine>,
    pub fold_lines: Vec<FoldLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Issue {
    pub code: String,
    pub severity: String,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartAllocation {
    pub part_index: usize,
    #[serde(rename = "type")]
    pub kind: String,
    pub pdf_pages: Vec<Option<usize>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BodySummary {
    pub body_pages: usize,
    pub pages_per_signature: usize,
    pub pieces_per_signature: usize,
    pub blanks_added: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerSheet {
    pub part_indexes: Vec<usize>,
    pub per_sheet: usize,
    pub sheets: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Fillers {
    pub count: usize,
    pub size: Size,
}

/// The imposition of a whole book. On an error issue, `sheets` is empty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    /// The sheet size every side uses.
    pub sheet: Size,
    pub sheets: Vec<Sheet>,
    pub allocations: Vec<PartAllocation>,
    pub body: Option<BodySummary>,
    pub per_sheet: Vec<PerSheet>,
    pub fillers: Fillers,
    pub issues: Vec<Issue>,
}

/// A Layout that could not be read. The message names the offending field
/// and its line and column.
#[derive(Debug)]
pub struct LayoutError(serde_json::Error);

impl fmt::Display for LayoutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid layout JSON: {}", self.0)
    }
}

impl std::error::Error for LayoutError {}

pub fn parse(json: &str) -> Result<Layout, LayoutError> {
    serde_json::from_str(json).map_err(LayoutError)
}
