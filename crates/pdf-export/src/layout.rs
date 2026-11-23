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
/// `part_page` is its index in the part's allocation `pdf_pages`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PagePlacement {
    pub pdf_page: Option<usize>,
    pub part_index: usize,
    pub part_page: usize,
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

/// How marks are drawn, in points: every tick `stroke_width` wide, cut
/// ticks solid, fold ticks with the on and off lengths in `dash`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkStyle {
    pub stroke_width: f64,
    pub dash: MarkDash,
}

/// On and off lengths for a spine fold tick and for one that opens by trim.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkDash {
    pub spine: Vec<f64>,
    pub opens_by_trim: Vec<f64>,
}

/// The exact mark segments to draw on one side, in that side's
/// coordinates. The engine places them clear of every clip and with no two
/// overlapping; the back's sit behind the front's after the duplex flip.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SideMarks {
    pub cut: Vec<SheetLine>,
    pub fold: Vec<FoldLine>,
}

/// `guides` are the full cut and fold lines in this side's coordinates, for
/// previews; the marks to draw are `marks`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SheetSide {
    pub placements: Vec<PagePlacement>,
    pub guides: SideMarks,
    pub marks: SideMarks,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Sheet {
    pub front: SheetSide,
    pub back: SheetSide,
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
    pub leaf_pages: LeafPages,
}

/// Blank pages of the leaves the boards wrap, at the start and end of the body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeafPages {
    pub before: usize,
    pub after: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PerSheet {
    pub part_indexes: Vec<usize>,
    pub per_sheet: usize,
    pub sheets: usize,
}

/// One fold of a piece lying front face up as on the sheet: the `moves`
/// half ("left", "right", "top" or "bottom") turns over about `line` (piece
/// trim coordinates) under ("mountain") or over ("valley") the other half.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssemblyFold {
    pub order: usize,
    pub line: SheetLine,
    pub moves: String,
    pub direction: String,
    pub opens_by_trim: bool,
}

/// One cut piece: its trim rect on the sheet front and how it folds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssemblyPiece {
    pub id: usize,
    pub sheet: usize,
    pub slot: Rect,
    pub cols: usize,
    pub rows: usize,
    pub turned: bool,
    pub part_index: usize,
    pub kind: String,
    pub folds: Vec<AssemblyFold>,
}

/// The pieces nested into one signature, outermost first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignatureNest {
    pub part_index: usize,
    pub pieces: Vec<usize>,
}

/// The leaf a board's strip folds around: "first" or "last" of a signature.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoardWrap {
    pub signature: usize,
    pub leaf: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssemblyBoard {
    pub piece_id: usize,
    pub position: String,
    pub wraps: BoardWrap,
}

/// One step of the gathering order: an index into `signatures` or `boards`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GatherStep {
    pub kind: String,
    pub index: usize,
}

/// How to make the book from the printed sheets (see `Assembly` in
/// engine/src/types.ts). The exporter does not use it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assembly {
    pub flip_axis: String,
    pub pieces: Vec<AssemblyPiece>,
    pub signatures: Vec<SignatureNest>,
    pub boards: Vec<AssemblyBoard>,
    pub order: Vec<GatherStep>,
}

/// The imposition of a whole book. On an error issue, `sheets` is empty
/// and `assembly` is None.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    /// The sheet size every side uses.
    pub sheet: Size,
    pub sheets: Vec<Sheet>,
    pub allocations: Vec<PartAllocation>,
    pub body: Option<BodySummary>,
    pub per_sheet: Vec<PerSheet>,
    pub issues: Vec<Issue>,
    /// How every side's `marks` are drawn.
    pub mark_style: MarkStyle,
    /// None on an error layout.
    pub assembly: Option<Assembly>,
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
