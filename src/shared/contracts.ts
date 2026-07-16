/** Serializable metadata only; file contents never cross the process boundary. */
export type SelectedFolder = {
  path: string
  name: string
}

export type InventoryFile = {
  relativePath: string
  name: string
  extension: string
  sizeBytes: number
  modifiedAt: string
}

export type InventoryFolder = {
  relativePath: string
  name: string
}

export type Inventory = {
  fingerprint: string
  scannedAt: string
  files: InventoryFile[]
  folders: InventoryFolder[]
  skippedSymlinks: string[]
}
