import { redirect } from 'react-router'

/**
 * /ask: the Ask box lives at the top of the Saved tab (/), so this sends people there; AskBox focuses its input
 * (id "ask") when the URL fragment is #ask. No tab of its own (the Mode Tabs stay as designed).
 */
export function loader() {
  throw redirect('/#ask')
}

export default function Ask() {
  return null
}
