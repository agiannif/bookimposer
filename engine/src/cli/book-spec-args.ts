// Turns the book-spec CLI's flags and the PDF's page sizes into a BookSpec.
import type { BookSpec, DuplexFlip, FoldCount, PartSpec, Size } from '../types.ts'
import { SHEET_SIZES, type SheetName } from '../sheets.ts'

const VALUE_FLAGS = ['--signatures', '--folds', '--sheet', '--margin', '--gap', '--bleed', '--duplex']
const SWITCH_FLAGS = ['--front-board', '--back-board']

function nonNegative(flag: string, text: string): number {
  const n = Number(text)
  if (text.trim() === '' || !Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a number of points >= 0, got "${text}"`)
  return n
}

function parseSheet(text: string): Size {
  if (Object.hasOwn(SHEET_SIZES, text)) return SHEET_SIZES[text as SheetName]
  const match = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(text)
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new Error(`--sheet must be letter, a4, tabloid, a3 or WxH in points, got "${text}"`)
  }
  return { width: Number(match[1]), height: Number(match[2]) }
}

export function parseBookSpecArgs(argv: string[], pageSizes: Size[]): BookSpec {
  const values = new Map<string, string>()
  const switches = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (SWITCH_FLAGS.includes(flag)) switches.add(flag)
    else if (VALUE_FLAGS.includes(flag)) {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`)
      values.set(flag, argv[++i])
    } else throw new Error(`unknown flag ${flag}`)
  }

  const signaturesText = values.get('--signatures')
  if (signaturesText === undefined) throw new Error('--signatures is required')
  const signatures = Number(signaturesText)
  if (!Number.isInteger(signatures) || signatures < 1) throw new Error(`--signatures must be a whole number >= 1, got "${signaturesText}"`)

  const foldsText = values.get('--folds') ?? '1'
  if (!['1', '2', '3'].includes(foldsText)) throw new Error(`--folds must be 1, 2 or 3, got "${foldsText}"`)

  const duplex = values.get('--duplex') ?? 'long-edge'
  if (duplex !== 'long-edge' && duplex !== 'short-edge') throw new Error(`--duplex must be long-edge or short-edge, got "${duplex}"`)

  const parts: PartSpec[] = [{ type: 'body', signatures, folds: Number(foldsText) as FoldCount }]
  if (switches.has('--front-board')) parts.unshift({ type: 'board' })
  if (switches.has('--back-board')) parts.push({ type: 'board' })

  return {
    pageSizes,
    parts,
    print: {
      sheet: parseSheet(values.get('--sheet') ?? 'letter'),
      duplex: duplex as DuplexFlip,
      margin: nonNegative('--margin', values.get('--margin') ?? '18'),
      gap: nonNegative('--gap', values.get('--gap') ?? '0'),
      bleed: nonNegative('--bleed', values.get('--bleed') ?? '0'),
    },
    mismatch: 'fit',
  }
}
