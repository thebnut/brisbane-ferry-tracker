import { redirect } from 'react-router'

/**
 * /feedback: the feedback sheet opens from the transit pages' footer, so this sends people to the landing page with
 * ?feedback=1, which opens it (the footer's FeedbackButton).
 */
export function loader() {
  throw redirect('/?feedback=1')
}

export default function Feedback() {
  return null
}
