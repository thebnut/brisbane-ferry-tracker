import { redirect } from 'react-router'

/**
 * /feedback: the feedback sheet opens from the footer of the My Transit tab, so this sends people there with ?feedback=1,
 * which opens it (the footer's FeedbackButton).
 */
export function loader() {
  throw redirect('/?feedback=1')
}

export default function Feedback() {
  return null
}
