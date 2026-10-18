// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from '../src/BottomSheet.tsx'

describe('BottomSheet focus wrap', () => {
  it('Tab on the last control goes to the first, Shift+Tab on the first goes to the last', async () => {
    // jsdom has no layout; treat every element as rendered.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    render(
      <BottomSheet open onClose={() => {}} title="Sheet">
        <input aria-label="Field" />
        <button type="button">Last</button>
      </BottomSheet>,
    )
    const close = await screen.findByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'Last' })
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    // Mid-sheet Tab is left to the browser.
    const field = screen.getByLabelText('Field')
    field.focus()
    fireEvent.keyDown(field, { key: 'Tab' })
    expect(document.activeElement).toBe(field)
  })
})
