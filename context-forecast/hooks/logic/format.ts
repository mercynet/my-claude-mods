export type Weather = { symbol: string; word: string; color: string }

const WEATHER_BANDS: readonly Weather[] = [
  { symbol: '☼', word: 'Limpo', color: 'yellow' },
  { symbol: '☁', word: 'Nublado', color: 'cyan' },
  { symbol: '☂', word: 'Chuva', color: 'blue' },
  { symbol: 'ϟ', word: 'Tempestade', color: 'magenta' },
  { symbol: '!', word: 'Compactar agora', color: 'red' }
]

// 25% is already "Nublado": below 25 is "Limpo", 25 to 49 "Nublado".
const percentBand = (percent: number): number => (percent < 25 ? 0 : percent < 50 ? 1 : percent < 75 ? 2 : percent < 90 ? 3 : 4)

export const weatherFor = (percent: number): Weather => WEATHER_BANDS[percentBand(percent)]!

// A percentage alone calls a 1M window "Limpo" at 135k, right below the heavy threshold. The absolute thresholds
// set a floor: half of heavy is already "Nublado", heavy "Chuva", high "Tempestade"; the worse of the two bands wins.
export const weatherBand = (tokens: number, percent: number, thresholds: { heavy: number; high: number }): Weather => {
  const absolute = tokens >= thresholds.high ? 3 : tokens >= thresholds.heavy ? 2 : tokens >= thresholds.heavy / 2 ? 1 : 0

  return WEATHER_BANDS[Math.max(percentBand(percent), absolute)]!
}

export const compactNumber = (n: number): string => {
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export const signedNumber = (n: number): string => `${n < 0 ? '-' : '+'}${compactNumber(Math.abs(n))}`

export const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000))

  if (minutes < 1) return '<1min'
  if (minutes < 60) return `${minutes}min`

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    const rest = minutes % 60

    return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`
  }

  const days = Math.floor(hours / 24)
  const leftover = hours % 24

  return leftover === 0 ? `${days}d` : `${days}d${leftover}h`
}

export const money = (usd: number): string => `$${usd.toFixed(2)}`

export const fileName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

export const shortPath = (path: string): string => path.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
