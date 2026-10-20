/**
 * P4 onboarding's picker and tray in jsdom, which has no WebGL: the map shows "Map unavailable", and the search and
 * "Stops in view" list are the whole path (keyboard and screen reader), as on a device without WebGL. Also the
 * prompt's show-once behaviour.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPicker, { type ModeSource } from '../src/OnboardingPicker.tsx'
import OnboardingPrompt from '../src/OnboardingPrompt.tsx'
import { markOnboardingDone, ONBOARDING_KEY, shouldOffer, type TrayState } from '../src/onboarding.ts'

vi.mock('../src/geolocation.ts', () => ({ useGeolocation: () => ({ geo: { state: 'idle' } }) }))

const CBD = { lat: -27.4705, lon: 153.0235 }
const busStops = [
  { id: '10802', name: 'Cultural Centre, platform 1', code: '10802', ...CBD },
  { id: '1832', name: 'King George Square', code: '1832', lat: CBD.lat + 0.001, lon: CBD.lon },
]
const terminals = [
  { id: 'riverside', name: 'Riverside', ...CBD },
  { id: 'bulimba', name: 'Bulimba', lat: CBD.lat + 0.002, lon: CBD.lon },
  { id: 'hawthorne', name: 'Hawthorne', lat: CBD.lat - 0.002, lon: CBD.lon },
]
const byName =
  <T extends { name: string }>(list: T[]) =>
  (q: string) =>
    list.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))

const SOURCES: ModeSource[] = [
  {
    mode: 'bus',
    label: 'Bus',
    title: 'Bus stops',
    noun: 'stop',
    shape: 'diamond',
    stops: busStops,
    search: byName(busStops),
  },
  {
    mode: 'ferry',
    label: 'Ferry',
    title: 'Ferry terminals',
    noun: 'terminal',
    shape: 'circle',
    stops: terminals,
    search: byName(terminals),
    destinations: (from) => terminals.filter((t) => t.id !== from && t.id !== 'hawthorne'),
  },
]

function renderPicker(onSave = vi.fn((_: TrayState) => true as boolean | undefined), onClose = vi.fn()) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  render(
    <main>
      <p>the page</p>
      <OnboardingPicker sources={SOURCES} onSave={onSave} onClose={onClose} />
    </main>,
  )
  return { onSave, onClose }
}
const tray = () => within(screen.getByRole('complementary', { name: 'Your favourite stops' }))
const trayNames = () =>
  [...document.querySelectorAll('[data-tray-items] > li')].map((li) => li.querySelector('p')?.textContent)

describe('onboarding picker without WebGL', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows Map unavailable, and the list and search still fill the tray', () => {
    const { onSave } = renderPicker()
    expect(screen.getByText('Map unavailable on this device')).toBeTruthy()
    expect(screen.getByText(/Search for a stop by name/)).toBeTruthy()
    // "Stops in view": the stops around the map's centre, as buttons that add without leaving the list.
    fireEvent.click(screen.getByRole('button', { name: /Stops in view \(2\)/ }))
    const row = screen.getByRole('button', { name: /Cultural Centre/ })
    fireEvent.click(row)
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('list', { name: 'Bus stops in view' })).toBeTruthy()
    expect(tray().getByRole('status').textContent).toBe('Added Cultural Centre, platform 1')
    // Search by name.
    fireEvent.change(tray().getByLabelText('Find a stop by name'), { target: { value: 'king' } })
    fireEvent.click(tray().getByRole('button', { name: /King George Square/ }))
    expect(trayNames()).toEqual(['Cultural Centre, platform 1', 'King George Square'])
    // Reorder and remove.
    fireEvent.click(tray().getByRole('button', { name: 'Move King George Square up' }))
    expect(trayNames()).toEqual(['King George Square', 'Cultural Centre, platform 1'])
    fireEvent.click(tray().getByRole('button', { name: 'Remove King George Square' }))
    expect(trayNames()).toEqual(['Cultural Centre, platform 1'])
    fireEvent.click(tray().getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0]?.[0].items).toEqual([
      { mode: 'bus', id: '10802', name: 'Cultural Centre, platform 1', detail: 'Stop 10802' },
    ])
  })

  it('is a modal dialog: the page behind is inert, and Escape from the tray closes it', () => {
    const { onClose } = renderPicker()
    expect(
      screen.getByRole('dialog', { name: 'Set up your favourite stops' }).getAttribute('aria-modal'),
    ).toBe('true')
    expect(screen.getByText('the page').hasAttribute('inert')).toBe(true)
    fireEvent.keyDown(tray().getByLabelText('Find a stop by name'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('ferry: the tapped terminal is From, the tray asks for a reachable destination, then Save', () => {
    const { onSave } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Ferry' }))
    expect(screen.getByRole('button', { name: 'Ferry' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(tray().getByLabelText('Find a terminal by name'), { target: { value: 'bul' } })
    fireEvent.click(tray().getByRole('button', { name: /Bulimba/ }))
    expect(trayNames()).toEqual(['From Bulimba'])
    const save = tray().getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    const to = tray().getByRole('combobox', { name: 'To' }) as HTMLSelectElement
    // Only reachable terminals (the test's network leaves Hawthorne out).
    expect([...to.options].map((o) => o.value)).toEqual(['', 'riverside'])
    fireEvent.change(to, { target: { value: 'riverside' } })
    expect(save.disabled).toBe(false)
    // A second terminal replaces From.
    fireEvent.change(tray().getByLabelText('Find a terminal by name'), { target: { value: 'riv' } })
    fireEvent.click(tray().getByRole('button', { name: /Riverside/ }))
    expect(trayNames()).toEqual(['From Riverside'])
    fireEvent.change(tray().getByRole('combobox', { name: 'To' }), { target: { value: 'bulimba' } })
    fireEvent.click(tray().getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]?.[0].items).toEqual([
      { mode: 'ferry', id: 'riverside', name: 'Riverside', to: 'bulimba' },
    ])
  })

  it('a refused save keeps the tray and says so', () => {
    const { onClose } = renderPicker(vi.fn(() => false))
    fireEvent.change(tray().getByLabelText('Find a stop by name'), { target: { value: 'king' } })
    fireEvent.click(tray().getByRole('button', { name: /King George Square/ }))
    fireEvent.click(tray().getByRole('button', { name: 'Save' }))
    expect(tray().getByRole('status').textContent).toMatch(/Couldn't save on this device/)
    expect(trayNames()).toEqual(['King George Square'])
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('onboarding prompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  const mount = (onAnswer = vi.fn()) =>
    render(
      <OnboardingPrompt
        offer={() => shouldOffer({ anySaved: false })}
        renderPicker={(close) => (
          <button type="button" onClick={close}>
            picker
          </button>
        )}
        onAnswer={onAnswer}
      />,
    )

  it('waits for an idle moment, never takes focus, and "Not now" is final', () => {
    const onAnswer = vi.fn()
    mount(onAnswer)
    expect(screen.queryByText('Set up your favourite stops?')).toBeNull()
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText('Set up your favourite stops?')).toBeTruthy()
    expect(document.activeElement).toBe(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('Set up your favourite stops?')).toBeNull()
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('1')
    expect(onAnswer).toHaveBeenCalledOnce()
  })

  it('Yes opens the picker, and is final too', () => {
    mount()
    act(() => vi.advanceTimersByTime(2000))
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(screen.getByRole('button', { name: 'picker' })).toBeTruthy()
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'picker' }))
    expect(screen.queryByRole('button', { name: 'picker' })).toBeNull()
  })

  it('goes when something is saved while it shows, and Yes then opens nothing (Codex r1)', () => {
    let saved = false
    render(
      <OnboardingPrompt offer={() => shouldOffer({ anySaved: saved })} renderPicker={() => <p>picker</p>} />,
    )
    act(() => vi.advanceTimersByTime(2000))
    const yes = screen.getByRole('button', { name: 'Yes' })
    saved = true
    fireEvent.click(yes)
    expect(screen.queryByText('picker')).toBeNull()
    expect(screen.queryByText('Set up your favourite stops?')).toBeNull()
  })

  it('goes by itself within a second of a save elsewhere on the page', () => {
    let saved = false
    render(<OnboardingPrompt offer={() => shouldOffer({ anySaved: saved })} renderPicker={() => null} />)
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByText('Set up your favourite stops?')).toBeTruthy()
    saved = true
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText('Set up your favourite stops?')).toBeNull()
    expect(localStorage.getItem(ONBOARDING_KEY)).toBe('1')
  })

  it('focus goes back to what had it once the picker closes, never to <body> (Codex r1)', () => {
    render(
      <main>
        <h1>My stops</h1>
        <button type="button">search</button>
        <OnboardingPrompt
          offer={() => shouldOffer({ anySaved: false })}
          renderPicker={(close) => (
            <button type="button" onClick={close}>
              close picker
            </button>
          )}
        />
      </main>,
    )
    screen.getByRole('button', { name: 'search' }).focus()
    act(() => vi.advanceTimersByTime(2000))
    // Its own keyboard path: focus moves to Yes, Enter opens the picker, which closes again.
    screen.getByRole('button', { name: 'Yes' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    const close = screen.getByRole('button', { name: 'close picker' })
    close.focus()
    fireEvent.click(close)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'search' }))
  })

  it('without an earlier focus, the page heading takes it', () => {
    render(
      <main>
        <h1>My stops</h1>
        <OnboardingPrompt offer={() => shouldOffer({ anySaved: false })} renderPicker={() => null} />
      </main>,
    )
    act(() => vi.advanceTimersByTime(2000))
    const notNow = screen.getByRole('button', { name: 'Not now' })
    notNow.focus()
    fireEvent.click(notNow)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'My stops' }))
  })

  it('going by itself (something saved) leaves focus where it is (Codex r2)', () => {
    let saved = false
    render(
      <main>
        <h1>My stops</h1>
        <OnboardingPrompt offer={() => shouldOffer({ anySaved: saved })} renderPicker={() => null} />
      </main>,
    )
    act(() => vi.advanceTimersByTime(2000))
    expect(document.activeElement).toBe(document.body)
    saved = true
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText('Set up your favourite stops?')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('going by itself while one of its buttons has focus puts focus back (Codex r3)', () => {
    let saved = false
    render(
      <main>
        <h1>My stops</h1>
        <button type="button">search</button>
        <OnboardingPrompt offer={() => shouldOffer({ anySaved: saved })} renderPicker={() => null} />
      </main>,
    )
    screen.getByRole('button', { name: 'search' }).focus()
    act(() => vi.advanceTimersByTime(2000))
    screen.getByRole('button', { name: 'Yes' }).focus()
    saved = true
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByText('Set up your favourite stops?')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'search' }))
  })

  it('never shows once answered', () => {
    markOnboardingDone()
    mount()
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.queryByText('Set up your favourite stops?')).toBeNull()
  })
})
