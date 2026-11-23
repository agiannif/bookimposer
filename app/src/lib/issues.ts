// The issues the workspace shows: the engine's, plus what only the app can tell (the engine threw,
// or bleed is on but the PDF has no bleed to show). They share one shape so the banner shows them
// alike and any error disables export.
import { impose, MARK_STYLE, type BookSpec, type Issue, type IssueCode, type Layout } from "../../../engine/src/index.ts";
import type { PageBoxes } from "./backend.ts";
import { formatLength, type Unit } from "./units.ts";

export type AppIssueCode = IssueCode | "layout-failed" | "no-bleed-box";

export interface AppIssue {
  code: AppIssueCode;
  severity: Issue["severity"];
  message: string;
  data?: Issue["data"];
}

const failedLayout = (): Layout => ({
  sheet: { width: 0, height: 0 },
  sheets: [],
  allocations: [],
  body: null,
  perSheet: [],
  issues: [],
  markStyle: MARK_STYLE,
  assembly: null,
});

/**
 * The engine's layout and issues, or an empty layout with a layout-failed error if it throws,
 * so a bad setting shows in the banner instead of leaving the previous layout on screen.
 */
export function imposeSafely(spec: BookSpec, imposeSpec: (spec: BookSpec) => Layout = impose): { layout: Layout; issues: AppIssue[] } {
  try {
    const layout = imposeSpec(spec);
    return { layout, issues: layout.issues };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { layout: failedLayout(), issues: [{ code: "layout-failed", severity: "error", message: `These settings can't be laid out: ${reason}` }] };
  }
}

/** A warning when bleed is on but pages the layout places have no BleedBox, so nothing fills the bleed. */
export function bleedWarnings(bleed: number, layout: Layout, boxes: PageBoxes[], unit: Unit): AppIssue[] {
  if (bleed <= 0) return [];
  const placed = [...new Set(layout.allocations.flatMap((a) => a.pdfPages))].filter((p): p is number => p !== null).sort((a, b) => a - b);
  const missing = placed.filter((p) => boxes[p]?.bleed === null);
  if (missing.length === 0) return [];
  const amount = `${formatLength(bleed, unit)} ${unit}`;
  const message = missing.length === placed.length
    ? `Bleed is set to ${amount}, but this PDF has no bleed area, so page edges will show white`
    : `Bleed is set to ${amount}, but pages ${missing.map((p) => p + 1).join(", ")} have no bleed area, so their edges will show white`;
  return [{ code: "no-bleed-box", severity: "warning", message }];
}

