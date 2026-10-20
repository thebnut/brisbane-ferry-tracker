/**
 * The Ask box's example chips. Each must get a real answer from the deterministic parser (no ambiguous or unresolved
 * stop): services/edge/test/ask-places.test.ts runs them through the parser and resolver (R11-A1).
 */
export const ASK_EXAMPLES = [
  'next train from Bowen Hills to the airport',
  'next ferry from Bulimba',
  'alerts on the Ferny Grove line',
] as const
