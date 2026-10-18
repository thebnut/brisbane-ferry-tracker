/** Strip " ferry terminal" for display (legacy cleanStopName). */
export const cleanStopName = (name: string) => name.replace(/\s+ferry terminal$/i, '').trim()
