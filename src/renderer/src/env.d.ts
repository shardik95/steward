export {}

import type { Inventory, SelectedFolder } from '../../shared/contracts'

declare global {
  interface Window {
    /** The deliberately small, typed API exposed by Electron's preload script. */
    steward: {
      pickFolder(): Promise<SelectedFolder | null>
      getInventory(): Promise<Inventory>
    }
  }
}
