/**
 * Feedback form rules and submit, matching the legacy FeedbackModal (src/components/FeedbackModal.jsx) and the
 * /api/feedback relay (workers/legacy.ts, api/feedback.js): feedback 10–1000 characters, optional email and name.
 */
export const FEEDBACK_MIN = 10
export const FEEDBACK_MAX = 1000

export interface FeedbackForm {
  feedback: string
  email: string
  name: string
}

export const EMPTY_FEEDBACK: FeedbackForm = { feedback: '', email: '', name: '' }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The legacy client's validation message for the first rule broken, or null when the form can be sent. */
export function validateFeedback(form: FeedbackForm): string | null {
  if (form.feedback.trim().length < FEEDBACK_MIN) return 'Please provide at least 10 characters of feedback'
  if (form.feedback.length > FEEDBACK_MAX) return 'Feedback must be less than 1000 characters'
  if (form.email && !EMAIL_RE.test(form.email)) return 'Please provide a valid email address'
  return null
}

/** Whether the submit button is enabled (legacy: by raw character count). */
export const canSubmitFeedback = (form: FeedbackForm) =>
  form.feedback.length >= FEEDBACK_MIN && form.feedback.length <= FEEDBACK_MAX

const GENERIC_ERROR = 'Failed to submit feedback. Please try again.'

/** Shown when the invisible Turnstile check can't produce a token (blocked script, offline, timed out). */
export const TURNSTILE_ERROR =
  "We couldn't complete the bot check. Check your connection and try again. If it keeps failing, a content blocker may be blocking challenges.cloudflare.com."

/**
 * POST to the same-origin relay, with the Turnstile token the relay requires from web clients
 * (api/_turnstile.js); throws an Error carrying the server's message on failure.
 */
export async function submitFeedback(
  form: FeedbackForm,
  fetchImpl: typeof fetch = fetch,
  turnstileToken?: string | null,
): Promise<void> {
  let res: Response
  try {
    res = await fetchImpl('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnstileToken ? { ...form, turnstileToken } : form),
    })
  } catch {
    throw new Error(GENERIC_ERROR)
  }
  if (res.ok) return
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  throw new Error(typeof body?.error === 'string' && body.error ? body.error : 'Failed to submit feedback')
}
