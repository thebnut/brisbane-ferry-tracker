/**
 * THE-118 PR 4: the row's platform tile puts the platform number (and "PLAT" at 9 px) on the line colour, so every
 * line colour needs a text colour at WCAG AA for small text (4.5:1). Light lines (Gold Coast, Redcliffe) get charcoal.
 */
import { contrastRatio, textOn } from '@bft/ui'
import { describe, expect, it } from 'vitest'
import { LINE_COLOURS } from '../app/lib/lineNames.ts'
import { LINES } from '../app/lib/network.ts'

const colours = [...new Set([...Object.values(LINE_COLOURS), ...LINES.map((l) => l.color), '666D8E'])]

describe('platform tile text on every train line colour', () => {
  it.each(colours)('#%s reaches 4.5:1', (c) => {
    expect(contrastRatio(c, textOn(c))).toBeGreaterThanOrEqual(4.5)
  })
  it('light lines get dark text', () => {
    expect(textOn(LINE_COLOURS['Gold Coast'] as string)).toBe('2D3436')
    expect(textOn(LINE_COLOURS['Redcliffe Peninsula'] as string)).toBe('2D3436')
    expect(textOn(LINE_COLOURS.Beenleigh as string)).toBe('FFFFFF')
  })
})
