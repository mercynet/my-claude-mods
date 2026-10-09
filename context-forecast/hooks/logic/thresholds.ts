import type { ClearSample } from '../../types'

// The "time to clear" warning is heuristic: nobody measures the model "getting lost" directly.
// Over 70 recorded sessions on a 1M window the person cleared at a median of 393k (p25 240k, p75 529k),
// almost never below 300k, and tool errors stayed flat (4-5%) up to 800k, so the defaults sit where
// clearing actually starts to happen. The percentages only bind on smaller windows (a 200k window
// is heavy at 100k, not 300k): the effective threshold is the lower of the two.
export const DEFAULT_THRESHOLDS = { heavy: 300_000, high: 650_000, heavyPercent: 50, highPercent: 75 } as const

export const MIN_SAMPLES = 5
export const MAX_SAMPLES = 30
export const MIN_SAMPLE_TOKENS = 10_000

// Bounds as shares of the window, so a 200k window is never held to a 1M window's numbers.
const HEAVY_FLOOR = 0.2
const HIGH_FLOOR = 0.3
const HIGH_CEILING = 0.9
const STEP = 5_000

export type Quartiles = { p25: number; p75: number }

export type Thresholds = {
  heavy: number
  high: number
  heavyPercent: number
  highPercent: number
  calibrated: boolean
  samples: number
  quartiles: Quartiles | null
}

export const quantile = (values: readonly number[], q: number): number | null => {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * q
  const below = Math.floor(position)
  const above = Math.ceil(position)

  return sorted[below]! + (sorted[above]! - sorted[below]!) * (position - below)
}

export const median = (values: readonly number[]): number | null => quantile(values, 0.5)

const roundToStep =(n: number): number => Math.round(n / STEP) * STEP

const clamp = (n: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, n))

export const defaultThresholds = (samples = 0): Thresholds => ({
  ...DEFAULT_THRESHOLDS,
  calibrated: false,
  samples,
  quartiles: null
})

// Only clears made on a window of the same size count: clearing at 39% of a 1M window says nothing about
// where the person clears on a 200k one. Heavy is where a quarter of the clears had already happened and
// high where three quarters had, so the first warning no longer lands below the person's own habit.
export const calibrate = (samples: readonly ClearSample[], window: number, enabled = true): Thresholds => {
  const recent = samples.filter(sample => sample.window === window).slice(-MAX_SAMPLES)

  if (!enabled || window <= 0 || recent.length < MIN_SAMPLES) return defaultThresholds(recent.length)

  const tokens = recent.map(sample => sample.tokens)
  const p25 = quantile(tokens, 0.25)!
  const p75 = quantile(tokens, 0.75)!
  const high = roundToStep(clamp(p75, window * HIGH_FLOOR, window * HIGH_CEILING))
  const heavy = Math.min(high, roundToStep(clamp(p25, window * HEAVY_FLOOR, window * HIGH_CEILING)))

  return {
    heavy,
    high,
    heavyPercent: Math.round((heavy / window) * 100),
    highPercent: Math.round((high / window) * 100),
    calibrated: true,
    samples: recent.length,
    quartiles: { p25, p75 }
  }
}

export const appendSample = (samples: readonly ClearSample[], next: ClearSample): ClearSample[] =>
  next.tokens < MIN_SAMPLE_TOKENS ? [...samples] : [...samples, next].slice(-MAX_SAMPLES)

export const readSamples = (stored: unknown): ClearSample[] => {
  if (!Array.isArray(stored)) return []

  return stored.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return []

    const { tokens, window, reason, at } = item as Record<string, unknown>

    return typeof tokens === 'number' &&
      typeof window === 'number' &&
      typeof at === 'number' &&
      (reason === 'clear' || reason === 'compact')
      ? [{ tokens, window, reason, at }]
      : []
  })
}
