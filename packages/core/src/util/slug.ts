/** Stable, human-readable stop/station slugs (ADR-0007): derived from names, never from rotating platform IDs. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(ferry terminal|station|railway station|train station)\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Strip " ferry terminal" / " station" suffixes for display (matches the legacy cleanStopName). */
export function cleanStopName(name: string): string {
  return name
    .replace(/\s+ferry terminal$/i, '')
    .replace(/\s+station$/i, '')
    .trim()
}
