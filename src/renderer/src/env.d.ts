export {}

declare global {
  interface Window {
    /** The deliberately small, typed API exposed by Electron's preload script. */
    steward: {
      pickFolder(): Promise<string | null>
    }
  }
}
