// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FeedbackSheet from '../app/components/FeedbackSheet.tsx'
import {
  canSubmitFeedback,
  EMPTY_FEEDBACK,
  type FeedbackForm,
  submitFeedback,
  validateFeedback,
} from '../app/lib/feedback.ts'

const form = (over: Partial<FeedbackForm>): FeedbackForm => ({ ...EMPTY_FEEDBACK, ...over })

describe('feedback validation (legacy FeedbackModal rules)', () => {
  it('needs at least 10 characters after trimming', () => {
    expect(validateFeedback(form({ feedback: '' }))).toBe('Please provide at least 10 characters of feedback')
    expect(validateFeedback(form({ feedback: '   short   ' }))).toBe(
      'Please provide at least 10 characters of feedback',
    )
    expect(validateFeedback(form({ feedback: '0123456789' }))).toBeNull()
  })
  it('allows up to 1000 characters', () => {
    expect(validateFeedback(form({ feedback: 'x'.repeat(1000) }))).toBeNull()
    expect(validateFeedback(form({ feedback: 'x'.repeat(1001) }))).toBe(
      'Feedback must be less than 1000 characters',
    )
  })
  it('email and name are optional; a given email must look valid', () => {
    const ok = 'Great app, thanks!'
    expect(validateFeedback(form({ feedback: ok, email: 'a@b.co', name: 'Al' }))).toBeNull()
    expect(validateFeedback(form({ feedback: ok, email: 'not-an-email' }))).toBe(
      'Please provide a valid email address',
    )
    expect(validateFeedback(form({ feedback: ok, email: 'a b@c.d' }))).toBe(
      'Please provide a valid email address',
    )
  })
  it('the submit button follows the raw character count', () => {
    expect(canSubmitFeedback(form({ feedback: '123456789' }))).toBe(false)
    expect(canSubmitFeedback(form({ feedback: '1234567890' }))).toBe(true)
    expect(canSubmitFeedback(form({ feedback: 'x'.repeat(1001) }))).toBe(false)
  })
})

describe('submitFeedback', () => {
  it('posts the legacy body shape to the same-origin relay', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ success: true }))
    await submitFeedback(form({ feedback: 'Hello there world', email: 'a@b.co' }), fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('/api/feedback')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      feedback: 'Hello there world',
      email: 'a@b.co',
      name: '',
    })
  })
  it("surfaces the server's error message, or a generic one", async () => {
    await expect(
      submitFeedback(form({}), async () => Response.json({ error: 'Invalid email format' }, { status: 400 })),
    ).rejects.toThrow('Invalid email format')
    await expect(submitFeedback(form({}), async () => new Response('oops', { status: 502 }))).rejects.toThrow(
      'Failed to submit feedback',
    )
    await expect(
      submitFeedback(form({}), async () => {
        throw new TypeError('network')
      }),
    ).rejects.toThrow('Failed to submit feedback. Please try again.')
  })
})

describe('FeedbackSheet', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows the count, keeps submit disabled until 10 characters, then thanks and closes after 2 s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true })),
    )
    const onClose = vi.fn()
    render(<FeedbackSheet onClose={onClose} />)
    const box = await screen.findByLabelText(/Your feedback/)
    const submit = screen.getByRole('button', { name: 'Submit feedback' })
    fireEvent.change(box, { target: { value: 'short' } })
    expect(screen.getByText('Minimum 10 characters')).toBeInTheDocument()
    expect(screen.getByText('5/1000')).toBeInTheDocument()
    expect(submit).toBeDisabled()
    fireEvent.change(box, { target: { value: 'Please add Apollo Road' } })
    expect(submit).toBeEnabled()
    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(submit)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Thank you!')
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows an invalid email without posting, and a server error as an alert', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: 'Failed to submit feedback' }, { status: 500 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<FeedbackSheet onClose={() => {}} />)
    fireEvent.change(await screen.findByLabelText(/Your feedback/), {
      target: { value: 'A useful suggestion' },
    })
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'nope' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Please provide a valid email address')
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: '' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }))
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to submit feedback')
    // The form stays filled in for a retry.
    expect(screen.getByLabelText(/Your feedback/)).toHaveValue('A useful suggestion')
  })
})
