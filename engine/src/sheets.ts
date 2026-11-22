// Named paper sizes in PDF points, portrait. Shared by the CLI and the app.
import type { Size } from './types.ts'

export type SheetName = 'letter' | 'a4' | 'tabloid' | 'a3'

export const SHEET_SIZES: Record<SheetName, Size> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  tabloid: { width: 792, height: 1224 },
  a3: { width: 841.89, height: 1190.55 },
}
