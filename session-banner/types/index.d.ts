export type ArtText = string | null

declare module 'claude-code' {
  interface PluginState {
    'session-banner': {
      hasShown: boolean
      isVisible: boolean
      isColor: boolean
      frame: number
      shownAt: number
      art: ArtText
      tagline: string
    }
  }
}
