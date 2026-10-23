/** The bus route tile in the ferry look (the train elements are in train.tsx). */
import { cx } from './cx.ts'

export type RouteTileSize = 'sm' | 'md' | 'lg' | 'xl'

export interface RouteTileProps {
  route: string
  /** Metro, CityGlider and BUZ routes use the orange tile. */
  variant?: 'standard' | 'premium'
  /** sm: chips in lists; md: My stops rows; lg: departure rows (default); xl: trip detail hero. */
  size?: RouteTileSize
  className?: string
}

const PREMIUM = /^(M\d+|GLIDER|G\d+|BUZ)$/i
/** CityGlider routes (route_long_name doesn't say so in the SEQ feed). */
export const CITYGLIDER_ROUTES: ReadonlySet<string> = new Set(['60', '61'])
/** BUZ (high-frequency) routes, translink.com.au/travel-with-us/buses/buz, October 2026. */
export const BUZ_ROUTES: ReadonlySet<string> = new Set([
  '100',
  '111',
  '120',
  '130',
  '140',
  '150',
  '180',
  '196',
  '199',
  '200',
  '222',
  '330',
  '333',
  '340',
  '345',
  '385',
  '412',
  '444',
  '555',
])

/** Bus routes that get the orange tile: Brisbane Metro (M1, M2), CityGlider and BUZ routes. */
export function routeTileVariant(route: string, routeLong?: string): 'standard' | 'premium' {
  if (PREMIUM.test(route) || CITYGLIDER_ROUTES.has(route) || BUZ_ROUTES.has(route)) return 'premium'
  if (routeLong && /cityglider|metro/i.test(routeLong)) return 'premium'
  return 'standard'
}

const TILE_SIZE: Record<RouteTileSize, string> = {
  sm: 'h-6 min-w-9 rounded-md px-1.5 text-xs shadow-none',
  md: 'h-11 min-w-13 rounded-[10px] px-1.5 text-xl',
  lg: 'h-13 min-w-15 rounded-card px-1.5 text-2xl shadow-[inset_0_-3px_0_rgb(0_0_0/0.15)]',
  xl: 'h-16 min-w-18 rounded-card px-2 text-[34px] shadow-[inset_0_-4px_0_rgb(0_0_0/0.15)]',
}

/** The bus "blind" tile: route number as the hero, teal (orange for premium routes). */
export function RouteTile({ route, variant = 'standard', size, className }: RouteTileProps) {
  return (
    <span
      data-variant={variant}
      className={cx(
        'flex shrink-0 items-center justify-center font-extrabold text-white tabular',
        size ? TILE_SIZE[size] : 'h-12 min-w-14 rounded-button px-2 text-xl shadow-card',
        variant === 'premium' ? 'bg-ferry-orange-aa' : 'bg-teal-text',
        className,
      )}
    >
      <span className="sr-only">Route </span>
      {route}
    </span>
  )
}
