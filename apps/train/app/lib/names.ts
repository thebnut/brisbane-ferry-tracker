/**
 * Strip " station" for display (same rule as @bft/core cleanStopName; kept local so the client bundle doesn't pull in
 * the core package's zod schemas).
 */
export const cleanStopName = (name: string) =>
  name
    .replace(/\s+(railway\s+|train\s+)?station$/i, '')
    .replace(/\s+station,\s+platform\s+\S+$/i, '')
    .trim()
