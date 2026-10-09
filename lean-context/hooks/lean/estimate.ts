export const BYTES_PER_TOKEN = 4

export const byteLength = (text: string): number => new TextEncoder().encode(text).length

export const tokensFromBytes = (bytes: number): number => Math.round(bytes / BYTES_PER_TOKEN)

export const formatKb = (bytes: number): string => (bytes / 1024).toFixed(1)

const decimalComma = (value: string): string => value.replace('.', ',')

export const formatKbPt = (bytes: number): string => decimalComma(formatKb(bytes))

export const formatInt = (value: number): string =>
  Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export const formatTokens = (tokens: number): string =>
  Math.abs(tokens) >= 1000 ? `${decimalComma((tokens / 1000).toFixed(1))}k` : formatInt(tokens)

export const formatPercent = (ratio: number): string => `${decimalComma((ratio * 100).toFixed(1))}%`

export const mean = (values: readonly number[]): number | undefined =>
  values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length
