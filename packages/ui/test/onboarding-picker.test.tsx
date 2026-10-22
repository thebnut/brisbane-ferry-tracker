/**
 * P4 onboarding's picker and tray in jsdom, which has no WebGL: the map shows "Map unavailable", and the search and
 * "Stops in view" list are the whole path (keyboard and screen reader), as on a device without WebGL. Also the
 * prompt's show-once behaviour.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OnboardingPicker, { type ModeSource } from '../src/OnboardingPicker.tsx'
import OnboardingPrompt, { measureLift } from '../src/OnboardingPrompt.tsx'
import {
  markOnboardingDone,
  ONBOARDING_KEY,
  shouldOffer,
  type TrayItem,
  type TrayState,
} from '../src/onboarding.ts'

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

function renderPicker(
  onSave = vi.fn((_: TrayState) => true as boolean | undefined),
  onClose = vi.fn(),
  initialItems?: TrayItem[],
) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
  render(
    <main>
      <p>the page</p>
      <OnboardingPicker sources={SOURCES} initialItems={initialItems} onSave={onSave} onClose={onClose} />
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

describe('onboarding picker re-run from Settings (THE-113)', () => {
  const SAVED: TrayItem[] = [
    { mode: 'bus', id: '1832', name: 'King George Square' },
    { mode: 'ferry', id: 'bulimba', name: 'Bulimba', to: 'riverside' },
  ]
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens with the saved stops in the tray, already picked, titled for My Transit', () => {
    renderPicker(undefined, undefined, SAVED)
    expect(screen.getByRole('dialog', { name: 'Set up My Transit stops' })).toBeTruthy()
    expect(trayNames()).toEqual(['King George Square', 'From Bulimba'])
    expect((tray().getByRole('combobox', { name: 'To' }) as HTMLSelectElement).value).toBe('riverside')
    // Picked on the list too: a tap there takes it out.
    fireEvent.change(tray().getByLabelText('Find a stop by name'), { target: { value: 'king' } })
    const row = within(tray().getByRole('list', { name: /matching king/ })).getByRole('button')
    expect(row.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(row)
    expect(trayNames()).toEqual(['From Bulimba'])
  })

  it('add one, remove one, Save hands over the tray as it stands', () => {
    const { onSave } = renderPicker(undefined, undefined, SAVED)
    fireEvent.change(tray().getByLabelText('Find a stop by name'), { target: { value: 'cultural' } })
    fireEvent.click(tray().getByRole('button', { name: /Cultural Centre/ }))
    fireEvent.click(tray().getByRole('button', { name: 'Remove King George Square' }))
    fireEvent.click(tray().getByRole('button', { name: /^Save/ }))
    expect(onSave.mock.calls[0]?.[0].items.map((i) => `${i.mode}:${i.id}`)).toEqual([
      'ferry:bulimba',
      'bus:10802',
    ])
  })

  it('emptying the tray can be saved (it unsaves everything), and says so', () => {
    const { onSave } = renderPicker(undefined, undefined, SAVED)
    fireEvent.click(tray().getByRole('button', { name: 'Remove King George Square' }))
    fireEvent.click(tray().getByRole('button', { name: 'Remove Bulimba' }))
    expect(tray().getByText(/Saving now removes all your saved stops/)).toBeTruthy()
    fireEvent.click(tray().getByRole('button', { name: 'Save' }))
    expect(onSave.mock.calls[0]?.[0].items).toEqual([])
  })

  it('Cancel saves nothing', () => {
    const { onSave, onClose } = renderPicker(undefined, undefined, SAVED)
    fireEvent.click(tray().getByRole('button', { name: 'Remove King George Square' }))
    fireEvent.click(tray().getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
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

describe('onboarding prompt placement (R15)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  /** A fixed (or in-flow) element marked as a dock whose top edge is `top` px down a 844 px viewport. */
  function dock(top: number, position = 'fixed', height = 844 - top) {
    const el = document.createElement('div')
    el.setAttribute('data-bft-dock', '')
    el.style.position = position
    el.getBoundingClientRect = () => ({ top, height }) as DOMRect
    document.body.append(el)
  }
  function promptBox(height = 150) {
    const el = document.createElement('section')
    Object.defineProperty(el, 'offsetHeight', { value: height })
    return el
  }
  const phone = (wide = false) => {
    vi.stubGlobal('innerHeight', 844)
    vi.stubGlobal('matchMedia', () => ({ matches: wide }))
  }

  it('keeps its class position above a plain bottom nav', () => {
    phone()
    dock(780)
    expect(measureLift(promptBox())).toEqual({ bottom: 96, spacer: 96 + 150 - 64 })
  })

  it("rises above the highest dock: transit's section pills, then bus's search sheet over them", () => {
    phone()
    dock(796)
    dock(740)
    expect(measureLift(promptBox()).bottom).toBe(104 + 12)
    dock(574)
    const lift = measureLift(promptBox())
    expect(lift.bottom).toBe(270 + 12)
    // The page's end can scroll clear of the prompt too, not only of the docks.
    expect(lift.spacer).toBe(12 + 150)
  })

  it('ignores hidden docks and docks in the page flow (the bus trip footer on desktop)', () => {
    phone()
    dock(780)
    dock(500, 'fixed', 0)
    dock(400, 'static')
    expect(measureLift(promptBox()).bottom).toBe(96)
  })

  it('desktop: its md:bottom-6 position unless a fixed bar sits there (transit train pills)', () => {
    phone(true)
    expect(measureLift(promptBox()).bottom).toBe(24)
    dock(800)
    expect(measureLift(promptBox()).bottom).toBe(44 + 12)
  })

  it('moves at once when a dock mounts under it (a client navigation), not on the next timer tick (Codex r1)', async () => {
    vi.useFakeTimers()
    phone()
    dock(780)
    render(<OnboardingPrompt offer={() => true} renderPicker={() => null} />)
    act(() => vi.advanceTimersByTime(2000))
    const box = document.querySelector<HTMLElement>('[data-onboarding-prompt]') as HTMLElement
    expect(box.style.bottom).toBe('96px')
    dock(574)
    await act(async () => {
      await Promise.resolve()
    })
    expect(box.style.bottom).toBe(`${270 + 12}px`)
    vi.useRealTimers()
  })
})

describe('inline prompt (BrisbaneTransit My Transit, THE-118 PR 3)', () => {
  it('sits in the page flow: not fixed, no spacer, never lifted', () => {
    vi.useFakeTimers()
    render(<OnboardingPrompt offer={() => true} renderPicker={() => null} inline quietMs={0} />)
    act(() => vi.advanceTimersByTime(50))
    const box = document.querySelector<HTMLElement>('[data-onboarding-prompt]') as HTMLElement
    expect(box).toHaveAttribute('data-onboarding-inline')
    expect(box.className).not.toMatch(/\bfixed\b/)
    expect(box.style.bottom).toBe('')
    expect(document.querySelector('[data-onboarding-spacer]')).toBeNull()
    vi.useRealTimers()
  })
})
