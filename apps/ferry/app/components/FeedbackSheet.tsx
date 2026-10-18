/**
 * Feedback form (legacy FeedbackModal) in the round-2 sheet: feedback with a live character count, optional email
 * and name, then a thank-you that closes itself after 2 s. The native <dialog> in BottomSheet gives the focus trap and
 * Escape. Loaded lazily from the footer's "Send Feedback & Ideas" button.
 */
import { BottomSheet, Icon, PrimaryButton, SecondaryButton } from '@bft/ui'
import { type ChangeEvent, type FormEvent, useEffect, useId, useState } from 'react'
import {
  canSubmitFeedback,
  EMPTY_FEEDBACK,
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  type FeedbackForm,
  submitFeedback,
  validateFeedback,
} from '../lib/feedback.ts'

const FIELD =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-charcoal focus:border-ferry-orange focus:ring-2 focus:ring-ferry-orange focus:outline-none disabled:opacity-60'
const LABEL = 'mb-1.5 block text-sm font-semibold text-gray-700'

export default function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState<FeedbackForm>(EMPTY_FEEDBACK)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle')
  const [error, setError] = useState('')
  const id = useId()

  // Close after 2 s on success, like the legacy modal.
  useEffect(() => {
    if (status !== 'success') return
    const t = setTimeout(onClose, 2000)
    return () => clearTimeout(t)
  }, [status, onClose])

  const change = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const invalid = validateFeedback(form)
    if (invalid) {
      setError(invalid)
      return
    }
    setStatus('submitting')
    setError('')
    try {
      await submitFeedback(form)
      setStatus('success')
    } catch (err) {
      setStatus('idle')
      setError(
        err instanceof Error && err.message ? err.message : 'Failed to submit feedback. Please try again.',
      )
    }
  }

  const count = form.feedback.length
  const busy = status === 'submitting'
  return (
    <BottomSheet open onClose={onClose} title="Share your feedback">
      {status === 'success' ? (
        <div role="status" className="py-8 text-center">
          <Icon name="checkCircle" size={56} className="mx-auto text-chip-later-text" />
          <h3 className="mt-3 text-xl font-semibold text-chip-later-text">Thank you!</h3>
          <p className="mt-1 text-gray-700 dark:text-night-text/80">
            Your feedback has been submitted successfully.
          </p>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div>
            <label htmlFor={`${id}-feedback`} className={LABEL}>
              Your feedback{' '}
              <span aria-hidden="true" className="text-cancel-text">
                *
              </span>
            </label>
            <textarea
              id={`${id}-feedback`}
              name="feedback"
              rows={6}
              value={form.feedback}
              onChange={change}
              placeholder="Tell us your thoughts, ideas, or feature requests..."
              className={`${FIELD} resize-none`}
              required
              aria-describedby={`${id}-count`}
              aria-invalid={count > FEEDBACK_MAX || undefined}
              disabled={busy}
            />
            <div id={`${id}-count`} className="mt-1 flex justify-between text-xs text-gray-600">
              <span>{count > 0 && count < FEEDBACK_MIN ? `Minimum ${FEEDBACK_MIN} characters` : ''}</span>
              <span className={count > FEEDBACK_MAX ? 'font-semibold text-cancel-text' : undefined}>
                {count}/{FEEDBACK_MAX}
              </span>
            </div>
          </div>
          <div>
            <label htmlFor={`${id}-email`} className={LABEL}>
              Email <span className="font-normal text-gray-600">(optional)</span>
            </label>
            <input
              type="email"
              id={`${id}-email`}
              name="email"
              autoComplete="email"
              value={form.email}
              onChange={change}
              placeholder="your@email.com"
              className={FIELD}
              aria-describedby={`${id}-email-hint`}
              disabled={busy}
            />
            <p id={`${id}-email-hint`} className="mt-1 text-xs text-gray-600">
              Provide your email if you'd like us to follow up
            </p>
          </div>
          <div>
            <label htmlFor={`${id}-name`} className={LABEL}>
              Name <span className="font-normal text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              id={`${id}-name`}
              name="name"
              autoComplete="name"
              value={form.name}
              onChange={change}
              placeholder="Your name"
              className={FIELD}
              disabled={busy}
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-cancel-text/30 bg-cancel-bg p-3 text-sm text-cancel-text"
            >
              {error}
            </p>
          ) : null}
          <div className="flex gap-3 pt-2">
            <SecondaryButton className="flex-1" onClick={onClose} disabled={busy}>
              Cancel
            </SecondaryButton>
            <PrimaryButton type="submit" className="flex-1" disabled={busy || !canSubmitFeedback(form)}>
              {busy ? 'Submitting…' : 'Submit feedback'}
            </PrimaryButton>
          </div>
        </form>
      )}
    </BottomSheet>
  )
}
