// The length unit the app shows and accepts. Settings are stored in points; only inputs and readouts convert.
import { SHEET_SIZES, type SheetName } from "../../../engine/src/index.ts";

export type Unit = "in" | "mm" | "pt";
export const UNITS: readonly Unit[] = ["in", "mm", "pt"];
export const DEFAULT_UNIT: Unit = "in";

const POINTS_PER_UNIT: Record<Unit, number> = { in: 72, mm: 72 / 25.4, pt: 1 };
const DECIMALS: Record<Unit, number> = { in: 3, mm: 1, pt: 2 };

// Rounds to `decimals`. The toPrecision step drops float noise first, so 133.35 rounds up to 133.4
// where plain rounding would see 133.3499... and round down.
const trim = (n: number, decimals: number) => Math.round(Number((n * 10 ** decimals).toPrecision(12))) / 10 ** decimals;

/** Typed values land on exact points (0.25 in is 18 pt); the rounding removes float noise like 18.000000000000004. */
export function toPoints(value: number, unit: Unit): number {
  return trim(value * POINTS_PER_UNIT[unit], 6);
}

export function fromPoints(pt: number, unit: Unit): number {
  return pt / POINTS_PER_UNIT[unit];
}

/** The number a person reads: rounded for the unit, trailing zeros trimmed. */
export function formatLength(pt: number, unit: Unit): string {
  return String(trim(fromPoints(pt, unit), DECIMALS[unit]));
}

/** Typed text read as a length in `unit`, as points; null when it is not a number. */
export function parseLength(text: string, unit: Unit): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? toPoints(n, unit) : null;
}

const PRESET_NAMES: Record<SheetName, string> = { letter: "Letter", a4: "A4", tabloid: "Tabloid", a3: "A3" };

export function presetLabel(name: SheetName, unit: Unit): string {
  const { width, height } = SHEET_SIZES[name];
  return `${PRESET_NAMES[name]} (${formatLength(width, unit)} × ${formatLength(height, unit)} ${unit})`;
}

const STORAGE_KEY = "bookimposer.unit";
type UnitStorage = Pick<Storage, "getItem" | "setItem">;

// Storage can be missing or throw (private windows, blocked site data); the unit then just isn't remembered.
// null means no storage.
function defaultStorage(): UnitStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadUnit(storage: UnitStorage | null = defaultStorage()): Unit {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return UNITS.find((u) => u === stored) ?? DEFAULT_UNIT;
  } catch {
    return DEFAULT_UNIT;
  }
}

export function saveUnit(unit: Unit, storage: UnitStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, unit);
  } catch {
    // Not remembered; the unit still applies to this session.
  }
}
