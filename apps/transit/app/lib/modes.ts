/** Where each standalone app's screens are mounted in BrisbaneTransit (also read by modes.config.ts at build time). */
export const MODE_BASES = { ferry: '/ferry', train: '/train', bus: '/bus' } as const
export type MountedMode = keyof typeof MODE_BASES
